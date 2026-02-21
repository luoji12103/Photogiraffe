package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"photogiraffe/core/database"
	"photogiraffe/core/models"
	"photogiraffe/core/queue"
	"photogiraffe/core/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

// requireAuth checks the Authorization: Bearer <token> header.
func requireAuth(token string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		auth := c.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") || strings.TrimPrefix(auth, "Bearer ") != token {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
		}
		return c.Next()
	}
}

// requireInternalSecret checks the X-Internal-Secret header for worker-only routes.
func requireInternalSecret(secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if c.Get("X-Internal-Secret") != secret {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Forbidden"})
		}
		return c.Next()
	}
}

func main() {
	// Load auth credentials from environment
	adminToken := os.Getenv("ADMIN_TOKEN")
	if adminToken == "" {
		log.Fatal("ADMIN_TOKEN environment variable is not set. Refusing to start without authentication.")
	}
	internalSecret := os.Getenv("INTERNAL_SECRET")
	if internalSecret == "" {
		log.Fatal("INTERNAL_SECRET environment variable is not set. Refusing to start without worker authentication.")
	}
	corsAllowOrigin := os.Getenv("CORS_ALLOW_ORIGIN")
	if corsAllowOrigin == "" {
		corsAllowOrigin = "http://localhost:3000"
	}

	// Initialize Database Connection
	database.Connect()

	// Auto Migrate Models
	err := database.DB.AutoMigrate(&models.User{}, &models.Photo{}, &models.ExifData{}, &models.FeatureFlag{}, &models.AIConfig{})
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

	// Enable CORS — restricted to configured frontend origin
	app.Use(cors.New(cors.Config{
		AllowOrigins: corsAllowOrigin,
		AllowHeaders: "Origin, Content-Type, Accept, Authorization, X-Internal-Secret",
		AllowMethods: "GET, POST, PUT, DELETE, OPTIONS",
	}))

	app.Get("/health", func(c *fiber.Ctx) error {
		// Check DB connection
		sqlDB, err := database.DB.DB()
		if err != nil || sqlDB.Ping() != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database connection failed")
		}
		return c.SendString("Go Core API is healthy! Database connection is active.")
	})

	app.Post("/upload", requireAuth(adminToken), func(c *fiber.Ctx) error {
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
	app.Put("/internal/photos/:id/status", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")

		type StatusUpdate struct {
			Status   string           `json:"status"`
			ExifData *models.ExifData `json:"exif_data,omitempty"`
		}

		var update StatusUpdate
		if err := c.BodyParser(&update); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		// Update photo status
		result := database.DB.Model(&models.Photo{}).Where("id = ?", id).Update("status", update.Status)
		if result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update status"})
		}
		if result.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}

		// Save EXIF data if provided
		if update.ExifData != nil {
			var photoID uint
			database.DB.Model(&models.Photo{}).Where("id = ?", id).Select("id").Scan(&photoID)
			if photoID > 0 {
				update.ExifData.PhotoID = photoID
				database.DB.Create(update.ExifData)
			}
		}

		return c.JSON(fiber.Map{"message": "Status updated successfully"})
	})

	// API to get list of photos
	app.Get("/photos", func(c *fiber.Ctx) error {
		var photos []models.Photo
		result := database.DB.Preload("ExifData").Order("uploaded_at desc").Find(&photos)
		if result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch photos"})
		}
		return c.JSON(photos)
	})

	// API to get a single photo by ID
	app.Get("/photos/:id", func(c *fiber.Ctx) error {
		id := c.Params("id")
		var photo models.Photo
		result := database.DB.Preload("ExifData").First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		return c.JSON(photo)
	})

	// API to get AI Config
	app.Get("/api/config/ai", requireAuth(adminToken), func(c *fiber.Ctx) error {
		var config models.AIConfig
		result := database.DB.First(&config)
		if result.Error != nil {
			if result.Error == gorm.ErrRecordNotFound {
				return c.JSON(fiber.Map{}) // Return empty object if not found
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch AI config"})
		}
		// Hide API Key for security
		config.APIKey = "********"
		return c.JSON(config)
	})

	// API to update AI Config
	app.Post("/api/config/ai", requireAuth(adminToken), func(c *fiber.Ctx) error {
		var input models.AIConfig
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		var config models.AIConfig
		result := database.DB.First(&config)
		
		if result.Error != nil {
			if result.Error == gorm.ErrRecordNotFound {
				// Create new config
				database.DB.Create(&input)
				return c.JSON(fiber.Map{"message": "AI config created successfully"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch AI config"})
		}

		// Update existing config
		config.Provider = input.Provider
		config.BaseURL = input.BaseURL
		config.ModelName = input.ModelName
		if input.APIKey != "********" && input.APIKey != "" {
			config.APIKey = input.APIKey
		}
		database.DB.Save(&config)

		return c.JSON(fiber.Map{"message": "AI config updated successfully"})
	})

	// API to trigger AI Analysis
	app.Post("/api/photos/:id/analyze", requireAuth(adminToken), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var photo models.Photo
		result := database.DB.First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}

		var config models.AIConfig
		configResult := database.DB.First(&config)
		if configResult.Error != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "AI Configuration not found. Please configure AI settings first."})
		}

		// Push task to Redis Queue
		provider := config.Provider
		if provider == "" {
			provider = "openai_compatible"
		}
		taskData := map[string]interface{}{
			"photo_id":   photo.ID,
			"minio_path": photo.MinioPath,
			"provider":   provider,
			"base_url":   config.BaseURL,
			"api_key":    config.APIKey,
			"model_name": config.ModelName,
		}
		err := queue.PushTask("ai_analysis_queue", taskData)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to queue AI analysis task"})
		}

		return c.JSON(fiber.Map{"message": "AI analysis task queued successfully"})
	})

	// Internal API to update AI Analysis result
	app.Put("/internal/photos/:id/analysis", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var input struct {
			Analysis string `json:"analysis"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		var photo models.Photo
		result := database.DB.First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}

		photo.AIAnalysis = input.Analysis
		database.DB.Save(&photo)

		return c.JSON(fiber.Map{"message": "AI analysis updated successfully"})
	})

	fmt.Println("Starting Go Core API on :8080...")
	if err := app.Listen(":8080"); err != nil {
		log.Fatal(err)
	}
}
