package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"photogiraffe/core/auth"
	"photogiraffe/core/database"
	"photogiraffe/core/models"
	"photogiraffe/core/queue"
	"photogiraffe/core/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// requireJWT validates the Authorization: Bearer <jwt> header and writes
// userID, userRole, username into c.Locals.
func requireJWT() fiber.Handler {
	return func(c *fiber.Ctx) error {
		bearerStr := c.Get("Authorization")
		if !strings.HasPrefix(bearerStr, "Bearer ") {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing or invalid Authorization header"})
		}
		tokenStr := strings.TrimPrefix(bearerStr, "Bearer ")
		claims, err := auth.ValidateAccessToken(tokenStr)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid or expired token"})
		}
		c.Locals("userID", claims.UserID)
		c.Locals("userRole", claims.Role)
		c.Locals("username", claims.Username)
		return c.Next()
	}
}

// requireRole restricts access to users with one of the given roles.
// Must be used after requireJWT.
func requireRole(roles ...string) fiber.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(c *fiber.Ctx) error {
		role, _ := c.Locals("userRole").(string)
		if !allowed[role] {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Insufficient permissions"})
		}
		return c.Next()
	}
}

// userIDFromLocals extracts the authenticated user's ID from Fiber locals.
func userIDFromLocals(c *fiber.Ctx) uint {
	if v, ok := c.Locals("userID").(uint); ok {
		return v
	}
	return 0
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
	// JWT secret — fall back to dev default but warn
	if os.Getenv("JWT_SECRET") == "" {
		log.Println("WARNING: JWT_SECRET not set. Using insecure default. Set JWT_SECRET in production!")
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

	// Seed default Feature Flags if they don't exist
	defaultFlags := []struct {
		Name        string
		Enabled     bool
		Description string
	}{
		{"ai_analysis", false, "AI artwork analysis via multimodal LLM"},
		{"ai_infer_params", false, "AI-powered colour parameter inference"},
		{"export_engine", true, "Photo export engine"},
		{"preset_management", true, "Colour preset management"},
		{"raw_decode", true, "Browser-side RAW file decoding (libraw-wasm)"},
		{"hdr_display", true, "Wide-gamut / HDR rendering (WebGL + ACES)"},
	}
	for _, f := range defaultFlags {
		var ff models.FeatureFlag
		if err := database.DB.Where("feature_name = ?", f.Name).First(&ff).Error; err != nil {
			database.DB.Create(&models.FeatureFlag{
				FeatureName: f.Name,
				IsEnabled:   f.Enabled,
				Description: f.Description,
			})
		}
	}

	// Note: AutoMigrate is already performed inside database.Connect().
	// The duplicate call below is intentionally removed (B2 fix).

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

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 5 — JWT Authentication
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/auth/register — create a new user account
	app.Post("/api/auth/register", func(c *fiber.Ctx) error {
		var input struct {
			Username string `json:"username"`
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.BodyParser(&input); err != nil || input.Username == "" || input.Password == "" || input.Email == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "username, email and password are required"})
		}

		// First registered user becomes SuperAdmin
		var count int64
		database.DB.Model(&models.User{}).Count(&count)
		role := "StandardUser"
		if count == 0 {
			role = "SuperAdmin"
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to hash password"})
		}

		user := models.User{
			Username:     input.Username,
			Email:        input.Email,
			PasswordHash: string(hash),
			Role:         role,
		}
		if result := database.DB.Create(&user); result.Error != nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Username or email already taken"})
		}

		accessToken, _, err := auth.GenerateAccessToken(user.ID, user.Username, user.Role)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate token"})
		}

		rawRefresh, hashRefresh, err := auth.GenerateRefreshToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate refresh token"})
		}
		refreshExpiry := time.Now().Add(7 * 24 * time.Hour)
		database.DB.Create(&models.RefreshToken{
			UserID:    user.ID,
			TokenHash: hashRefresh,
			ExpiresAt: refreshExpiry,
		})

		c.Cookie(&fiber.Cookie{
			Name:     "refresh_token",
			Value:    rawRefresh,
			HTTPOnly: true,
			SameSite: "Strict",
			Expires:  refreshExpiry,
			Path:     "/",
		})

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"access_token": accessToken,
			"user": fiber.Map{
				"id":       user.ID,
				"username": user.Username,
				"email":    user.Email,
				"role":     user.Role,
			},
		})
	})

	// POST /api/auth/login — authenticate and issue tokens
	app.Post("/api/auth/login", func(c *fiber.Ctx) error {
		var input struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.BodyParser(&input); err != nil || input.Username == "" || input.Password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "username and password are required"})
		}

		var user models.User
		if result := database.DB.Where("username = ?", input.Username).First(&user); result.Error != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
		}

		accessToken, _, err := auth.GenerateAccessToken(user.ID, user.Username, user.Role)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate token"})
		}

		rawRefresh, hashRefresh, err := auth.GenerateRefreshToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate refresh token"})
		}
		refreshExpiry := time.Now().Add(7 * 24 * time.Hour)
		database.DB.Create(&models.RefreshToken{
			UserID:    user.ID,
			TokenHash: hashRefresh,
			ExpiresAt: refreshExpiry,
		})

		c.Cookie(&fiber.Cookie{
			Name:     "refresh_token",
			Value:    rawRefresh,
			HTTPOnly: true,
			SameSite: "Strict",
			Expires:  refreshExpiry,
			Path:     "/",
		})

		return c.JSON(fiber.Map{
			"access_token": accessToken,
			"user": fiber.Map{
				"id":       user.ID,
				"username": user.Username,
				"email":    user.Email,
				"role":     user.Role,
			},
		})
	})

	// POST /api/auth/refresh — issue new access token using refresh token cookie
	app.Post("/api/auth/refresh", func(c *fiber.Ctx) error {
		rawToken := c.Cookies("refresh_token")
		if rawToken == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No refresh token"})
		}

		hashed := auth.HashToken(rawToken)
		var rt models.RefreshToken
		if result := database.DB.Where("token_hash = ? AND revoked = false AND expires_at > ?", hashed, time.Now()).First(&rt); result.Error != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid or expired refresh token"})
		}

		// Rotate: revoke old, issue new refresh token
		database.DB.Model(&rt).Update("revoked", true)

		var user models.User
		database.DB.First(&user, rt.UserID)

		accessToken, _, err := auth.GenerateAccessToken(user.ID, user.Username, user.Role)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate token"})
		}

		rawNew, hashNew, err := auth.GenerateRefreshToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate refresh token"})
		}
		newExpiry := time.Now().Add(7 * 24 * time.Hour)
		database.DB.Create(&models.RefreshToken{
			UserID:    user.ID,
			TokenHash: hashNew,
			ExpiresAt: newExpiry,
		})
		c.Cookie(&fiber.Cookie{
			Name:     "refresh_token",
			Value:    rawNew,
			HTTPOnly: true,
			SameSite: "Strict",
			Expires:  newExpiry,
			Path:     "/",
		})

		return c.JSON(fiber.Map{"access_token": accessToken})
	})

	// POST /api/auth/logout — revoke current refresh token
	app.Post("/api/auth/logout", requireJWT(), func(c *fiber.Ctx) error {
		rawToken := c.Cookies("refresh_token")
		if rawToken != "" {
			hashed := auth.HashToken(rawToken)
			database.DB.Model(&models.RefreshToken{}).Where("token_hash = ?", hashed).Update("revoked", true)
		}
		c.ClearCookie("refresh_token")
		return c.JSON(fiber.Map{"message": "Logged out"})
	})

	// GET /api/auth/me — return current user profile
	app.Get("/api/auth/me", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var user models.User
		if result := database.DB.First(&user, uid); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
		}
		return c.JSON(fiber.Map{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
			"role":     user.Role,
		})
	})

	app.Post("/upload", requireJWT(), func(c *fiber.Ctx) error {
		// Parse the multipart form
		file, err := c.FormFile("image")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to get image from form"})
		}

		// Generate a unique filename — use filepath.Ext to correctly handle
		// extensions of any length (e.g. .jpeg, .tiff, .webp). (B1 fix)
		ext := filepath.Ext(file.Filename)
		if ext == "" {
			ext = ".jpg"
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
		UserID:           userIDFromLocals(c),
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

		// Save EXIF data if provided — use FirstOrCreate to prevent duplicate
		// rows accumulating when the worker retries. (B3 fix)
		if update.ExifData != nil {
			var photoID uint
			database.DB.Model(&models.Photo{}).Where("id = ?", id).Select("id").Scan(&photoID)
			if photoID > 0 {
				var existing models.ExifData
				result := database.DB.Where("photo_id = ?", photoID).First(&existing)
				if result.Error != nil {
					// No existing record — create fresh
					update.ExifData.PhotoID = photoID
					database.DB.Create(update.ExifData)
				} else {
					// Update in-place to avoid duplicates
					update.ExifData.Model = existing.Model
					update.ExifData.PhotoID = photoID
					database.DB.Save(update.ExifData)
				}
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
	app.Get("/api/config/ai", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
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
	app.Post("/api/config/ai", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
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
	app.Post("/api/photos/:id/analyze", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var photo models.Photo
		result := database.DB.First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		// B4 fix: only allow AI analysis on successfully processed photos;
		// otherwise the worker would fail because the proxy image doesn't exist.
		if photo.Status != "completed" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Photo processing is not complete yet. Please wait for the photo to finish processing before running AI analysis."})
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

		photo.AIAnalysis = &input.Analysis // B7 fix: *string so gorm writes NULL for unset fields
		database.DB.Save(&photo)

		return c.JSON(fiber.Map{"message": "AI analysis updated successfully"})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 4 — AI Parameter Inference
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/photos/:id/infer-params — trigger AI parameter inference
	app.Post("/api/photos/:id/infer-params", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var photo models.Photo
		result := database.DB.First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if photo.Status != "completed" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Photo processing is not complete yet"})
		}

		var config models.AIConfig
		if configResult := database.DB.First(&config); configResult.Error != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "AI configuration not found. Please configure AI settings first."})
		}

		provider := config.Provider
		if provider == "" {
			provider = "openai_compatible"
		}

		// Build proxy path (same pattern as AI analysis)
		proxyPath := strings.Replace(photo.MinioPath, "raw/", "proxy/", 1)
		// Replace extension with .webp
		lastDot := strings.LastIndex(proxyPath, ".")
		if lastDot > -1 {
			proxyPath = proxyPath[:lastDot] + ".webp"
		}

		if err := queue.PublishInferParamsTask(photo.ID, proxyPath, provider, config.BaseURL, config.APIKey, config.ModelName); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to queue parameter inference task"})
		}

		return c.JSON(fiber.Map{"message": "Parameter inference task queued successfully"})
	})

	// PUT /internal/photos/:id/inferred-params — Worker writes back inference result
	app.Put("/internal/photos/:id/inferred-params", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var input struct {
			InferredParams string `json:"inferred_params"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		var photo models.Photo
		if result := database.DB.First(&photo, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}

		photo.InferredParams = &input.InferredParams
		database.DB.Save(&photo)
		return c.JSON(fiber.Map{"message": "Inferred parameters saved"})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 4 — Preset Management
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/presets — save a named preset
	app.Post("/api/presets", requireJWT(), func(c *fiber.Ctx) error {
		var input struct {
			Name         string `json:"name"`
			Description  string `json:"description"`
			AdjustParams string `json:"adjust_params"` // raw JSON string
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if input.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Preset name is required"})
		}
		// Validate adjust_params is valid JSON
		if input.AdjustParams == "" {
			input.AdjustParams = "{}"
		}
		var check map[string]interface{}
		if err := json.Unmarshal([]byte(input.AdjustParams), &check); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid adjust_params JSON"})
		}

		preset := models.Preset{
			UserID:       userIDFromLocals(c),
			Name:         input.Name,
			Description:  input.Description,
			AdjustParams: input.AdjustParams,
		}
		if result := database.DB.Create(&preset); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create preset"})
		}
		return c.Status(fiber.StatusCreated).JSON(preset)
	})

	// GET /api/presets — list presets
	app.Get("/api/presets", requireJWT(), func(c *fiber.Ctx) error {
		var presets []models.Preset
		database.DB.Order("created_at desc").Find(&presets)
		return c.JSON(presets)
	})

	// DELETE /api/presets/:id — delete a preset
	app.Delete("/api/presets/:id", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var preset models.Preset
		if result := database.DB.First(&preset, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Preset not found"})
		}
		database.DB.Delete(&preset)
		return c.JSON(fiber.Map{"message": "Preset deleted"})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 4 — Export Engine
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/photos/:id/export — create export job and push to queue
	app.Post("/api/photos/:id/export", requireJWT(), func(c *fiber.Ctx) error {
		photoID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid photo ID"})
		}

		var photo models.Photo
		if result := database.DB.First(&photo, photoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if photo.Status != "completed" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Photo processing is not complete yet"})
		}

		// Parse export options from request body (permissive: use raw JSON)
		optsRaw := c.Body()
		if len(optsRaw) == 0 {
			optsRaw = []byte("{}")
		}
		// Validate it's valid JSON
		var optCheck map[string]interface{}
		if err := json.Unmarshal(optsRaw, &optCheck); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid export options JSON"})
		}

		job := models.ExportJob{
			PhotoID:       uint(photoID),
			UserID:        userIDFromLocals(c),
			Status:        "pending",
			ExportOptions: string(optsRaw),
		}
		if result := database.DB.Create(&job); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create export job"})
		}

		if err := queue.PublishExportTask(job.ID, uint(photoID), string(optsRaw)); err != nil {
			// Mark job as failed if we can't queue it
			database.DB.Model(&job).Updates(map[string]interface{}{"status": "failed", "error_message": err.Error()})
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to queue export task"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"message": "Export job created",
			"job_id":  job.ID,
		})
	})

	// GET /api/photos/:id/exports — list export jobs for a photo
	app.Get("/api/photos/:id/exports", requireJWT(), func(c *fiber.Ctx) error {
		photoID := c.Params("id")
		var jobs []models.ExportJob
		database.DB.Where("photo_id = ?", photoID).Order("created_at desc").Find(&jobs)
		return c.JSON(jobs)
	})

	// GET /api/exports/:job_id — query single export job status
	app.Get("/api/exports/:job_id", requireJWT(), func(c *fiber.Ctx) error {
		jobID := c.Params("job_id")
		var job models.ExportJob
		if result := database.DB.First(&job, jobID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Export job not found"})
		}
		return c.JSON(job)
	})

	// GET /api/exports/:job_id/download — generate presigned download URL
	app.Get("/api/exports/:job_id/download", requireJWT(), func(c *fiber.Ctx) error {
		jobID := c.Params("job_id")
		var job models.ExportJob
		if result := database.DB.First(&job, jobID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Export job not found"})
		}
		if job.Status != "completed" || job.OutputPath == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Export is not ready yet"})
		}

		presignExpiry := 15 * time.Minute
		presignedURL, err := storage.MinioClient.PresignedGetObject(
			c.Context(), "photos", job.OutputPath, presignExpiry, nil,
		)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate download URL"})
		}

		return c.JSON(fiber.Map{
			"url":        presignedURL.String(),
			"expires_in": int(presignExpiry.Seconds()),
		})
	})

	// PUT /internal/exports/:job_id/status — Python Worker updates export job status
	app.Put("/internal/exports/:job_id/status", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		jobID := c.Params("job_id")

		var input struct {
			Status      string `json:"status"`
			OutputPath  string `json:"output_path,omitempty"`
			ErrorMessage string `json:"error_message,omitempty"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		var job models.ExportJob
		if result := database.DB.First(&job, jobID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Export job not found"})
		}

		now := time.Now()
		updates := map[string]interface{}{
			"status":       input.Status,
			"output_path":  input.OutputPath,
			"error_message": input.ErrorMessage,
		}
		if input.Status == "completed" || input.Status == "failed" {
			updates["completed_at"] = &now
		}
		database.DB.Model(&job).Updates(updates)

		return c.JSON(fiber.Map{"message": "Export job status updated"})
	})

	fmt.Println("Starting Go Core API on :8080...")
	if err := app.Listen(":8080"); err != nil {
		log.Fatal(err)
	}
}
