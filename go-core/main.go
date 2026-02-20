package main

import (
	"fmt"
	"log"
	"time"

	"photogiraffe/core/database"
	"photogiraffe/core/models"
	"photogiraffe/core/queue"
	"photogiraffe/core/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

func main() {
	// Initialize Database Connection
	database.Connect()

	// Auto Migrate Models
	err := database.DB.AutoMigrate(&models.User{}, &models.Photo{}, &models.ExifData{}, &models.FeatureFlag{})
	if err != nil {
		log.Fatal("Failed to auto migrate database: ", err)
	}
	fmt.Println("Database migration completed successfully.")

	// Create a dummy user for testing
	var count int64
	database.DB.Model(&models.User{}).Count(&count)
	if count == 0 {
		dummyUser := models.User{
			Username:     "testuser",
			Email:        "test@example.com",
			PasswordHash: "dummyhash",
			Role:         "admin",
		}
		database.DB.Create(&dummyUser)
		fmt.Println("Created dummy user for testing.")
	}

	// Initialize MinIO Client
	storage.InitMinio()

	// Initialize Redis Client
	queue.InitRedis()

	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100 MB limit
	})

	app.Get("/health", func(c *fiber.Ctx) error {
		// Check DB connection
		sqlDB, err := database.DB.DB()
		if err != nil || sqlDB.Ping() != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database connection failed")
		}
		return c.SendString("Go Core API is healthy! Database connection is active.")
	})

	app.Post("/upload", func(c *fiber.Ctx) error {
		// Parse the multipart form
		file, err := c.FormFile("image")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to get image from form"})
		}

		// Generate a unique filename
		ext := ".jpg" // Default extension, should be extracted from original filename
		if len(file.Filename) > 4 {
			ext = file.Filename[len(file.Filename)-4:]
		}
		uniqueFilename := uuid.New().String() + ext
		bucketName := "photos"
		objectName := fmt.Sprintf("raw/%s", uniqueFilename)

		// Open the file
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to open uploaded file"})
		}
		defer src.Close()

		// Upload to MinIO
		ctx := c.Context()
		info, err := storage.MinioClient.PutObject(ctx, bucketName, objectName, src, file.Size, minio.PutObjectOptions{ContentType: "application/octet-stream"})
		if err != nil {
			log.Printf("Failed to upload to MinIO: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to upload to storage"})
		}
		fmt.Printf("Successfully uploaded %s of size %d\n", objectName, info.Size)

		// Create a record in PostgreSQL
		photo := models.Photo{
			UserID:           1, // Hardcoded for now, should come from JWT
			OriginalFilename: file.Filename,
			MinioPath:        objectName,
			Status:           "processing",
			UploadedAt:       time.Now(),
		}
		result := database.DB.Create(&photo)
		if result.Error != nil {
			log.Printf("Failed to create photo record: %v", result.Error)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save photo metadata"})
		}

		// Publish task to Redis Stream
		err = queue.PublishImageProcessingTask(photo.ID, objectName)
		if err != nil {
			log.Printf("Failed to publish task: %v", err)
			// We don't return an error here, as the photo is already saved and uploaded.
			// A retry mechanism should be implemented later.
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"message":  "Image uploaded successfully and queued for processing",
			"photo_id": photo.ID,
			"path":     objectName,
		})
	})

	// Internal API for Python Worker to update photo status
	app.Put("/internal/photos/:id/status", func(c *fiber.Ctx) error {
		id := c.Params("id")
		
		type StatusUpdate struct {
			Status string `json:"status"`
		}
		
		var update StatusUpdate
		if err := c.BodyParser(&update); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		result := database.DB.Model(&models.Photo{}).Where("id = ?", id).Update("status", update.Status)
		if result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update status"})
		}
		if result.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}

		return c.JSON(fiber.Map{"message": "Status updated successfully"})
	})

	fmt.Println("Starting Go Core API on :8080...")
	if err := app.Listen(":8080"); err != nil {
		log.Fatal(err)
	}
}