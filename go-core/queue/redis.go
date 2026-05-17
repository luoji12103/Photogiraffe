package queue

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/redis/go-redis/v9"
)

var RedisClient *redis.Client
var Ctx = context.Background()

func InitRedis() {
	host := os.Getenv("REDIS_HOST")
	password := os.Getenv("REDIS_PASSWORD")
	port := "6379"

	client := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", host, port),
		Password: password,
		DB:       0, // use default DB
	})

	_, err := client.Ping(Ctx).Result()
	if err != nil {
		log.Fatal("Failed to connect to Redis: ", err)
	}

	RedisClient = client
	fmt.Println("Successfully connected to Redis!")
}

func PublishImageProcessingTask(photoID uint, minioPath, traceparent string) error {
	streamName := "image_processing_queue"
	values := map[string]interface{}{
		"photo_id":   photoID,
		"minio_path": minioPath,
	}
	if traceparent != "" {
		values["traceparent"] = traceparent
	}
	err := RedisClient.XAdd(Ctx, &redis.XAddArgs{
		Stream: streamName,
		Values: values,
	}).Err()

	if err != nil {
		log.Printf("Failed to publish task to Redis Stream: %v", err)
		return err
	}

	fmt.Printf("Successfully published task for PhotoID %d to %s\n", photoID, streamName)
	return nil
}

func PushTask(streamName string, values map[string]interface{}) error {
	err := RedisClient.XAdd(Ctx, &redis.XAddArgs{
		Stream: streamName,
		Values: values,
	}).Err()

	if err != nil {
		log.Printf("Failed to publish task to Redis Stream %s: %v", streamName, err)
		return err
	}

	fmt.Printf("Successfully published task to %s\n", streamName)
	return nil
}

// PublishExportTask pushes an export job onto the export_queue Redis Stream.
func PublishExportTask(jobID uint, photoID uint, optsJSON, traceparent string) error {
	values := map[string]interface{}{
		"job_id":         jobID,
		"photo_id":       photoID,
		"export_options": optsJSON,
	}
	if traceparent != "" {
		values["traceparent"] = traceparent
	}
	return PushTask("export_queue", values)
}

// PublishAlbumExportTask pushes an album export job onto the export_queue Redis Stream.
func PublishAlbumExportTask(jobID uint, albumID uint, optsJSON, traceparent string) error {
	values := map[string]interface{}{
		"job_id":         jobID,
		"album_id":       albumID,
		"type":           "album_export",
		"export_options": optsJSON,
	}
	if traceparent != "" {
		values["traceparent"] = traceparent
	}
	return PushTask("export_queue", values)
}

// PublishInferParamsTask pushes an AI parameter inference job onto infer_params_queue.
func PublishInferParamsTask(photoID uint, minioPath string, provider, baseURL, apiKey, modelName, promptLanguage, traceparent string) error {
	values := map[string]interface{}{
		"photo_id":        photoID,
		"minio_path":      minioPath,
		"provider":        provider,
		"base_url":        baseURL,
		"api_key":         apiKey,
		"model_name":      modelName,
		"prompt_language": promptLanguage,
	}
	if traceparent != "" {
		values["traceparent"] = traceparent
	}
	return PushTask("infer_params_queue", values)
}
