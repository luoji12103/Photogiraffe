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

func PublishImageProcessingTask(photoID uint, minioPath string) error {
	streamName := "image_processing_queue"
	err := RedisClient.XAdd(Ctx, &redis.XAddArgs{
		Stream: streamName,
		Values: map[string]interface{}{
			"photo_id":   photoID,
			"minio_path": minioPath,
		},
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