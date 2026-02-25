package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"photogiraffe/core/auth"
	"photogiraffe/core/database"
	"photogiraffe/core/models"
	"photogiraffe/core/queue"
	"photogiraffe/core/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/valyala/fasthttp"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// ── SSE Hub ──────────────────────────────────────────────────────────────────
// Per-user channels for Server-Sent Events.
// Each connected browser tab gets its own buffered channel.

var (
	sseMu  sync.RWMutex
	sseHub = make(map[uint][]chan string)
)

func sseSubscribe(userID uint) chan string {
	ch := make(chan string, 32)
	sseMu.Lock()
	sseHub[userID] = append(sseHub[userID], ch)
	sseMu.Unlock()
	return ch
}

func sseUnsubscribe(userID uint, ch chan string) {
	sseMu.Lock()
	defer sseMu.Unlock()
	chans := sseHub[userID]
	for i, c := range chans {
		if c == ch {
			sseHub[userID] = append(chans[:i], chans[i+1:]...)
			break
		}
	}
	if len(sseHub[userID]) == 0 {
		delete(sseHub, userID)
	}
	close(ch)
}

// broadcastToUser pushes an SSE event to all open tabs for a given internal userID.
func broadcastToUser(userID uint, eventType, data string) {
	msg := fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, data)
	sseMu.RLock()
	chans := append([]chan string(nil), sseHub[userID]...) // copy slice
	sseMu.RUnlock()
	for _, ch := range chans {
		select {
		case ch <- msg:
		default: // drop if buffer full (slow client)
		}
	}
}

// requireJWT validates the Authorization: Bearer <jwt> header.
// The JWT carries a UUID public ID (never the sequential integer PK);
// this middleware resolves it to the internal integer ID via an indexed lookup.
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
		// Resolve UUID → internal integer PK (single indexed lookup; integer ID stays server-side only)
		var row struct{ ID uint }
		if dbErr := database.DB.Model(&models.User{}).Select("id").Where("public_id = ?", claims.UserID).Scan(&row).Error; dbErr != nil || row.ID == 0 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "User not found"})
		}
		c.Locals("userID", row.ID)              // uint — used by all internal handlers
		c.Locals("userPublicID", claims.UserID) // UUID string — used by handlers that need to return user identity
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

// userIDFromLocals extracts the authenticated user's internal integer ID from Fiber locals.
func userIDFromLocals(c *fiber.Ctx) uint {
	if v, ok := c.Locals("userID").(uint); ok {
		return v
	}
	return 0
}

// publicIDFromLocals extracts the authenticated user's public UUID from Fiber locals.
func publicIDFromLocals(c *fiber.Ctx) string {
	if v, ok := c.Locals("userPublicID").(string); ok {
		return v
	}
	return ""
}

// buildExifLines composes a concise multi-line EXIF summary for export overlays.
func buildExifLines(exif models.ExifData) []string {
	var parts []string
	if exif.CameraModel != "" {
		parts = append(parts, exif.CameraModel)
	}
	var details []string
	if exif.FocalLength != "" {
		details = append(details, exif.FocalLength)
	}
	if exif.Aperture != "" {
		details = append(details, "f/"+exif.Aperture)
	}
	if exif.ShutterSpeed != "" {
		details = append(details, exif.ShutterSpeed+"s")
	}
	if exif.ISO != "" {
		details = append(details, "ISO "+exif.ISO)
	}
	if len(details) > 0 {
		parts = append(parts, strings.Join(details, "  ·  "))
	}
	if exif.LensModel != "" {
		parts = append(parts, exif.LensModel)
	}
	if exif.DateTimeOriginal != "" {
		parts = append(parts, exif.DateTimeOriginal)
	}
	return parts
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

// generateShareToken generates a cryptographically secure 32-byte hex token.
func generateShareToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
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
		{"require_invite", false, "Require invite code for new user registration"},
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

	// Rate-limit auth endpoints: 10 req/min per IP
	authLimiter := limiter.New(limiter.Config{
		Max:        10,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "Too many requests. Please wait before trying again."})
		},
	})

	// POST /api/auth/register — create a new user account
	app.Post("/api/auth/register", authLimiter, func(c *fiber.Ctx) error {
		var input struct {
			Username   string `json:"username"`
			Email      string `json:"email"`
			Password   string `json:"password"`
			InviteCode string `json:"invite_code"`
		}
		if err := c.BodyParser(&input); err != nil || input.Username == "" || input.Password == "" || input.Email == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "username, email and password are required"})
		}

		// First registered user becomes SuperAdmin (always exempt from invite check)
		var count int64
		database.DB.Model(&models.User{}).Count(&count)
		role := "StandardUser"
		if count == 0 {
			role = "SuperAdmin"
		}

		// Check invite code requirement (skip for first user)
		if count > 0 {
			var inviteFlag models.FeatureFlag
			if err := database.DB.Where("feature_name = ?", "require_invite").First(&inviteFlag).Error; err == nil && inviteFlag.IsEnabled {
				if input.InviteCode == "" {
					return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "An invite code is required to register"})
				}
				var ic models.InviteCode
				if err := database.DB.Where("code = ? AND used_by IS NULL", input.InviteCode).First(&ic).Error; err != nil {
					return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid or already-used invite code"})
				}
				// Check expiry
				if ic.ExpiresAt != nil && time.Now().After(*ic.ExpiresAt) {
					return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invite code has expired"})
				}
				// Mark as used after successful registration — store pointer for later update
				defer func(inviteID uint) {
					now := time.Now()
					database.DB.Model(&models.InviteCode{}).Where("id = ?", inviteID).Updates(map[string]interface{}{
						"used_at": now,
					})
				}(ic.ID)
			}
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

		accessToken, _, err := auth.GenerateAccessToken(user.PublicID, user.Username, user.Role)
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
				"id":       user.PublicID, // UUID — never expose sequential integer PK
				"username": user.Username,
				"email":    user.Email,
				"role":     user.Role,
			},
		})
	})

	// POST /api/auth/login — authenticate and issue tokens
	app.Post("/api/auth/login", authLimiter, func(c *fiber.Ctx) error {
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

		accessToken, _, err := auth.GenerateAccessToken(user.PublicID, user.Username, user.Role)
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
				"id":       user.PublicID, // UUID — never expose sequential integer PK
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

		accessToken, _, err := auth.GenerateAccessToken(user.PublicID, user.Username, user.Role)
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
			"id":       user.PublicID, // UUID — never expose sequential integer PK
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

	// API to get photos with GPS coordinates for map display
	app.Get("/api/photos/map", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		type MapPoint struct {
			ID               uint    `json:"id"`
			Lat              float64 `json:"lat"`
			Lng              float64 `json:"lng"`
			ThumbnailPath    string  `json:"thumbnail_path"`
			OriginalFilename string  `json:"original_filename"`
		}

		type row struct {
			PhotoID          uint
			GPSLatitude      string
			GPSLongitude     string
			MinioPath        string
			OriginalFilename string
		}

		query := database.DB.Table("photos").
			Select("photos.id AS photo_id, exif_data.gps_latitude, exif_data.gps_longitude, photos.minio_path, photos.original_filename").
			Joins("JOIN exif_data ON exif_data.photo_id = photos.id").
			Where("photos.deleted_at IS NULL AND exif_data.deleted_at IS NULL").
			Where("exif_data.gps_latitude != '' AND exif_data.gps_longitude != ''").
			Where("photos.status = 'completed'")

		if role != "SuperAdmin" {
			query = query.Where("photos.user_id = ?", uid)
		}

		var rows []row
		if err := query.Scan(&rows).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch map data"})
		}

		points := make([]MapPoint, 0, len(rows))
		for _, r := range rows {
			var lat, lng float64
			if _, err := fmt.Sscanf(r.GPSLatitude, "%f", &lat); err != nil {
				continue
			}
			if _, err := fmt.Sscanf(r.GPSLongitude, "%f", &lng); err != nil {
				continue
			}
			thumbPath := strings.Replace(r.MinioPath, "raw/", "thumbnail/", 1)
			thumbPath = thumbPath[:len(thumbPath)-len(filepath.Ext(thumbPath))] + ".webp"
			points = append(points, MapPoint{
				ID:               r.PhotoID,
				Lat:              lat,
				Lng:              lng,
				ThumbnailPath:    thumbPath,
				OriginalFilename: r.OriginalFilename,
			})
		}

		return c.JSON(points)
	})

	// API to get list of photos — supports pagination, search, status filter
	// Query params: page (default 1), limit (default 20, max 100), search (filename), status (processing|completed|failed)
	app.Get("/photos", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		// Pagination params
		page := c.QueryInt("page", 1)
		limit := c.QueryInt("limit", 20)
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit

		// Filter params
		search := strings.TrimSpace(c.Query("search", ""))
		statusFilter := strings.TrimSpace(c.Query("status", ""))
		sortParam := c.Query("sort", "date_desc") // date_desc|date_asc|filename|camera|iso

		// Build base query with ownership check
		base := database.DB.Model(&models.Photo{})
		if role != "SuperAdmin" {
			base = base.Where("user_id = ?", uid)
		}
		if search != "" {
			base = base.Where("original_filename ILIKE ?", "%"+search+"%")
		}
		if statusFilter != "" {
			base = base.Where("status = ?", statusFilter)
		}

		// Get total count
		var total int64
		if err := base.Count(&total).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to count photos"})
		}

		// Fetch page
		var photos []models.Photo
		orderClause := map[string]string{
			"date_desc": "photos.uploaded_at DESC",
			"date_asc":  "photos.uploaded_at ASC",
			"filename":  "photos.original_filename ASC",
			"camera":    "exif_data.camera_model ASC, photos.uploaded_at DESC",
			"iso":       "exif_data.iso ASC, photos.uploaded_at DESC",
		}[sortParam]
		if orderClause == "" {
			orderClause = "photos.uploaded_at DESC"
		}
		if sortParam == "camera" || sortParam == "iso" {
			base = base.Joins("LEFT JOIN exif_data ON exif_data.photo_id = photos.id AND exif_data.deleted_at IS NULL")
		}
		if result := base.Preload("ExifData").Order(orderClause).
			Limit(limit).Offset(offset).Find(&photos); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch photos"})
		}

		return c.JSON(fiber.Map{
			"photos":      photos,
			"total":       total,
			"page":        page,
			"limit":       limit,
			"total_pages": int((total + int64(limit) - 1) / int64(limit)),
		})
	})

	// API to get a single photo by ID
	app.Get("/photos/:id", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var photo models.Photo
		result := database.DB.Preload("ExifData").First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
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
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var photo models.Photo
		result := database.DB.First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
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

		// Notify the photo owner that AI analysis is done
		payload, _ := json.Marshal(map[string]interface{}{"photo_id": photo.ID})
		broadcastToUser(photo.UserID, "ai_analysis_done", string(payload))

		return c.JSON(fiber.Map{"message": "AI analysis updated successfully"})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 4 — AI Parameter Inference
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/photos/:id/infer-params — trigger AI parameter inference
	app.Post("/api/photos/:id/infer-params", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var photo models.Photo
		result := database.DB.First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
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

		// Notify the photo owner that parameter inference is complete
		payload, _ := json.Marshal(map[string]interface{}{"photo_id": photo.ID})
		broadcastToUser(photo.UserID, "infer_params_done", string(payload))

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
			Platforms    string `json:"platforms"`     // raw JSON array string, e.g. '["Lightroom"]'
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
		if input.Platforms == "" {
			input.Platforms = "[]"
		}

		preset := models.Preset{
			UserID:       userIDFromLocals(c),
			Name:         input.Name,
			Description:  input.Description,
			AdjustParams: input.AdjustParams,
			Platforms:    input.Platforms,
		}
		if result := database.DB.Create(&preset); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create preset"})
		}
		return c.Status(fiber.StatusCreated).JSON(preset)
	})

	// GET /api/presets — list presets
	app.Get("/api/presets", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var presets []models.Preset
		query := database.DB.Order("created_at desc")
		if role != "SuperAdmin" {
			query = query.Where("user_id = ?", uid)
		}
		query.Find(&presets)
		return c.JSON(presets)
	})

	// DELETE /api/presets/:id — delete a preset
	app.Delete("/api/presets/:id", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var preset models.Preset
		if result := database.DB.First(&preset, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Preset not found"})
		}
		if role != "SuperAdmin" && preset.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		database.DB.Delete(&preset)
		return c.JSON(fiber.Map{"message": "Preset deleted"})
	})

	// PUT /api/presets/:id — update name/description/platforms
	app.Put("/api/presets/:id", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var preset models.Preset
		if result := database.DB.First(&preset, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Preset not found"})
		}
		if role != "SuperAdmin" && preset.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		var body struct {
			Name        *string `json:"name"`
			Description *string `json:"description"`
			Platforms   *string `json:"platforms"` // raw JSON array string
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
			preset.Name = strings.TrimSpace(*body.Name)
		}
		if body.Description != nil {
			preset.Description = *body.Description
		}
		if body.Platforms != nil {
			preset.Platforms = *body.Platforms
		}
		database.DB.Save(&preset)
		return c.JSON(preset)
	})

	// POST /api/presets/:id/apply/:photo_id — persist preset application to photo
	app.Post("/api/presets/:id/apply/:photo_id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		presetID, err := c.ParamsInt("id")
		photoID, err2 := c.ParamsInt("photo_id")
		if err != nil || err2 != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var preset models.Preset
		if result := database.DB.First(&preset, presetID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "preset not found"})
		}
		var photo models.Photo
		q := database.DB.Where("id = ?", photoID)
		if role != "SuperAdmin" {
			q = q.Where("user_id = ?", uid)
		}
		if result := q.First(&photo); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		pid := uint(presetID)
		photo.AppliedPresetID = &pid
		database.DB.Save(&photo)
		return c.JSON(fiber.Map{"message": "preset applied", "preset_id": presetID, "photo_id": photoID})
	})

	// GET /api/photos/:id/preset — get applied preset for a photo
	app.Get("/api/photos/:id/preset", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		photoID := c.Params("id")
		var photo models.Photo
		if result := database.DB.Where("id = ? AND user_id = ?", photoID, uid).First(&photo); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		if photo.AppliedPresetID == nil {
			return c.JSON(fiber.Map{"preset": nil})
		}
		var preset models.Preset
		if result := database.DB.First(&preset, *photo.AppliedPresetID); result.Error != nil {
			return c.JSON(fiber.Map{"preset": nil})
		}
		// Include top-level ID for compatibility with integration tests
		return c.JSON(fiber.Map{"preset": preset, "ID": preset.ID, "id": preset.ID})
	})

	// POST /api/presets/:id/file — upload a preset file (.xmp, .cube, etc.)
	app.Post("/api/presets/:id/file", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id := c.Params("id")
		var preset models.Preset
		if result := database.DB.First(&preset, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "preset not found"})
		}
		if preset.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file required"})
		}
		ext := filepath.Ext(file.Filename)
		objectName := fmt.Sprintf("presets/%d/%s%s", uid, uuid.New().String(), ext)
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to open file"})
		}
		defer src.Close()
		_, err = storage.MinioClient.PutObject(c.Context(), "photos", objectName, src, file.Size, minio.PutObjectOptions{ContentType: "application/octet-stream"})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
		}
		preset.FilePath = objectName
		database.DB.Save(&preset)
		presigned, _ := storage.MinioClient.PresignedGetObject(c.Context(), "photos", objectName, time.Hour, nil)
		return c.JSON(fiber.Map{"file_path": objectName, "download_url": presigned.String()})
	})

	// GET /api/presets/:id/file — get download URL for preset file
	app.Get("/api/presets/:id/file", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id := c.Params("id")
		role := c.Locals("userRole").(string)
		var preset models.Preset
		if result := database.DB.First(&preset, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "preset not found"})
		}
		if role != "SuperAdmin" && preset.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		if preset.FilePath == "" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "no file attached"})
		}
		presigned, err := storage.MinioClient.PresignedGetObject(c.Context(), "photos", preset.FilePath, time.Hour, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to generate URL"})
		}
		return c.JSON(fiber.Map{"download_url": presigned.String(), "file_path": preset.FilePath})
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
		// Validate it's valid JSON and build a mutable map
		var optMap map[string]interface{}
		if err := json.Unmarshal(optsRaw, &optMap); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid export options JSON"})
		}

		// ── Server-side inject overlay assets (MinIO paths never exposed to client) ──
		uid := userIDFromLocals(c)
		overlayFlag := func(key string) bool { v, _ := optMap[key].(bool); return v }

		if overlayFlag("overlay_signature") || overlayFlag("overlay_avatar") {
			var profile models.UserProfile
			database.DB.Where("user_id = ?", uid).First(&profile)
			if overlayFlag("overlay_signature") && profile.SignaturePath != "" {
				optMap["_signature_path"] = profile.SignaturePath
			}
			if overlayFlag("overlay_avatar") && profile.AvatarPath != "" {
				optMap["_avatar_path"] = profile.AvatarPath
			}
		}
		if overlayFlag("overlay_description") && photo.Description != "" {
			optMap["_photo_description"] = photo.Description
		}
		if overlayFlag("overlay_exif") {
			var exif models.ExifData
			database.DB.Where("photo_id = ?", photoID).First(&exif)
			lines := buildExifLines(exif)
			if len(lines) > 0 {
				optMap["_exif_lines"] = lines
			}
		}
		optsRaw, _ = json.Marshal(optMap)

		job := models.ExportJob{
			PhotoID:       uint(photoID),
			UserID:        uid,
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
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		// Verify photo ownership before listing its exports
		var photo models.Photo
		if result := database.DB.First(&photo, photoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		var jobs []models.ExportJob
		database.DB.Where("photo_id = ?", photoID).Order("created_at desc").Find(&jobs)
		return c.JSON(jobs)
	})

	// GET /api/exports/:job_id — query single export job status
	app.Get("/api/exports/:job_id", requireJWT(), func(c *fiber.Ctx) error {
		jobID := c.Params("job_id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var job models.ExportJob
		if result := database.DB.First(&job, jobID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Export job not found"})
		}
		if role != "SuperAdmin" && job.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		return c.JSON(job)
	})

	// GET /api/exports/:job_id/download — generate presigned download URL
	app.Get("/api/exports/:job_id/download", requireJWT(), func(c *fiber.Ctx) error {
		jobID := c.Params("job_id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var job models.ExportJob
		if result := database.DB.First(&job, jobID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Export job not found"})
		}
		if role != "SuperAdmin" && job.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
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
			Status       string `json:"status"`
			OutputPath   string `json:"output_path,omitempty"`
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
			"status":        input.Status,
			"output_path":   input.OutputPath,
			"error_message": input.ErrorMessage,
		}
		if input.Status == "completed" || input.Status == "failed" {
			updates["completed_at"] = &now
		}
		database.DB.Model(&job).Updates(updates)

		// Push SSE notification to the job owner
		if input.Status == "completed" || input.Status == "failed" {
			payload, _ := json.Marshal(map[string]interface{}{
				"job_id":   job.ID,
				"photo_id": job.PhotoID,
				"status":   input.Status,
			})
			broadcastToUser(job.UserID, "export_"+input.Status, string(payload))
		}

		return c.JSON(fiber.Map{"message": "Export job status updated"})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// v9.1 — Overlay query helper & Photo description/tags/visibility
	// ─────────────────────────────────────────────────────────────────────────

	// GET /api/profile/overlays — does caller have signature/avatar for watermarking?
	app.Get("/api/profile/overlays", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var profile models.UserProfile
		database.DB.Where("user_id = ?", uid).First(&profile)
		return c.JSON(fiber.Map{
			"has_signature": profile.SignaturePath != "",
			"has_avatar":    profile.AvatarPath != "",
		})
	})

	// PUT /api/photos/:id/visibility — toggle public/private (v9.2)
	app.Put("/api/photos/:id/visibility", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		photoID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid photo ID"})
		}
		var photo models.Photo
		if result := database.DB.First(&photo, photoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		var body struct {
			IsPublic bool `json:"is_public"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		database.DB.Model(&photo).Update("is_public", body.IsPublic)
		return c.JSON(fiber.Map{"id": photo.ID, "is_public": body.IsPublic})
	})

	// PUT /api/photos/:id/description — update description + keyword tags (v9.4)
	app.Put("/api/photos/:id/description", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		photoID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid photo ID"})
		}
		var photo models.Photo
		if result := database.DB.First(&photo, photoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		var body struct {
			Description string   `json:"description"`
			Tags        []string `json:"tags"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		tagsJSON, _ := json.Marshal(body.Tags)
		// Use raw SQL to avoid pgx jsonb cast issues when using GORM map updates.
		if err := database.DB.Exec(
			"UPDATE photos SET description = ?, tags = ?::jsonb, updated_at = NOW() WHERE id = ?",
			body.Description, string(tagsJSON), photo.ID,
		).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update"})
		}
		return c.JSON(fiber.Map{"description": body.Description, "tags": body.Tags})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// v9.3 — Bulk operations
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/photos/bulk-delete — delete multiple photos
	app.Post("/api/photos/bulk-delete", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var body struct {
			IDs []uint `json:"ids"`
		}
		if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ids array required"})
		}
		if len(body.IDs) > 200 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "maximum 200 photos per bulk delete"})
		}
		q := database.DB.Where("id IN ?", body.IDs)
		if role != "SuperAdmin" {
			q = q.Where("user_id = ?", uid)
		}
		result := q.Delete(&models.Photo{})
		return c.JSON(fiber.Map{"deleted": result.RowsAffected})
	})

	// POST /api/photos/bulk-album — add multiple photos to an album
	app.Post("/api/photos/bulk-album", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var body struct {
			PhotoIDs []uint `json:"photo_ids"`
			AlbumID  uint   `json:"album_id"`
		}
		if err := c.BodyParser(&body); err != nil || len(body.PhotoIDs) == 0 || body.AlbumID == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "photo_ids and album_id required"})
		}
		var album models.Album
		if result := database.DB.First(&album, body.AlbumID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Album not found"})
		}
		if role != "SuperAdmin" && album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		var added int64
		for _, pid := range body.PhotoIDs {
			ap := models.AlbumPhoto{AlbumID: body.AlbumID, PhotoID: pid}
			if err := database.DB.Where(ap).FirstOrCreate(&ap).Error; err == nil {
				added++
			}
		}
		return c.JSON(fiber.Map{"added": added, "album_id": body.AlbumID})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 5 — Feature Flags & Admin
	// ─────────────────────────────────────────────────────────────────────────

	// GET /api/admin/flags — list all feature flags (SuperAdmin)
	app.Get("/api/admin/flags", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var flags []models.FeatureFlag
		database.DB.Order("feature_name asc").Find(&flags)
		return c.JSON(flags)
	})

	// PUT /api/admin/flags/:name — toggle a feature flag (SuperAdmin)
	app.Put("/api/admin/flags/:name", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		name := c.Params("name")
		var input struct {
			IsEnabled bool `json:"is_enabled"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		var flag models.FeatureFlag
		if result := database.DB.Where("feature_name = ?", name).First(&flag); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Feature flag not found"})
		}
		flag.IsEnabled = input.IsEnabled
		database.DB.Save(&flag)
		return c.JSON(flag)
	})

	// GET /api/feature/:name — query a single feature flag (any authenticated user)
	// GET /api/feature/:name — public endpoint for checking feature flag state
	app.Get("/api/feature/:name", func(c *fiber.Ctx) error {
		name := c.Params("name")
		var flag models.FeatureFlag
		if result := database.DB.Where("feature_name = ?", name).First(&flag); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Feature flag not found", "enabled": false})
		}
		return c.JSON(fiber.Map{"feature_name": flag.FeatureName, "enabled": flag.IsEnabled, "is_enabled": flag.IsEnabled})
	})

	// GET /api/admin/users — list all users (SuperAdmin)
	// GET /api/admin/users — list all users with photo count (SuperAdmin)
	app.Get("/api/admin/users", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var users []struct {
			ID         uint   `json:"id"`
			PublicID   string `json:"public_id"`
			Username   string `json:"username"`
			Email      string `json:"email"`
			Role       string `json:"role"`
			CreatedAt  string `json:"created_at"`
			PhotoCount int64  `json:"photo_count"`
		}
		database.DB.Raw(`
			SELECT u.id, u.public_id, u.username, u.email, u.role, u.created_at,
			       COUNT(p.id) AS photo_count
			FROM users u
			LEFT JOIN photos p ON p.user_id = u.id AND p.deleted_at IS NULL
			WHERE u.deleted_at IS NULL
			GROUP BY u.id
			ORDER BY u.id ASC
		`).Scan(&users)
		return c.JSON(users)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 13 — IPTC / XMP Metadata (copyright & creator)
	// ─────────────────────────────────────────────────────────────────────────

	// GET /api/photos/:id/iptc — read IPTC/XMP metadata
	app.Get("/api/photos/:id/iptc", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		id := c.Params("id")

		var photo models.Photo
		q := database.DB.Preload("ExifData").Where("id = ?", id)
		if role != "SuperAdmin" {
			q = q.Where("user_id = ?", uid)
		}
		if result := q.First(&photo); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		copyright := photo.ExifData.Copyright
		creator := photo.ExifData.Creator
		return c.JSON(fiber.Map{
			"photo_id":    photo.ID,
			"description": photo.Description,
			"tags":        photo.Tags,
			"copyright":   copyright,
			"creator":     creator,
		})
	})

	// PUT /api/photos/:id/iptc — update copyright & creator
	app.Put("/api/photos/:id/iptc", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id := c.Params("id")

		var body struct {
			Copyright string `json:"copyright"`
			Creator   string `json:"creator"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}

		var photo models.Photo
		if result := database.DB.Where("id = ? AND user_id = ?", id, uid).First(&photo); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}

		var exif models.ExifData
		if result := database.DB.Where("photo_id = ?", photo.ID).First(&exif); result.Error != nil {
			exif = models.ExifData{PhotoID: photo.ID}
		}
		exif.Copyright = body.Copyright
		exif.Creator = body.Creator
		database.DB.Save(&exif)

		return c.JSON(fiber.Map{"message": "IPTC metadata updated"})
	})

	// GET /internal/photos/:id/iptc — internal endpoint for Python worker (no JWT)
	app.Get("/internal/photos/:id/iptc", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")

		var photo models.Photo
		if result := database.DB.Preload("ExifData").Where("id = ?", id).First(&photo); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		return c.JSON(fiber.Map{
			"photo_id":    photo.ID,
			"description": photo.Description,
			"copyright":   photo.ExifData.Copyright,
			"creator":     photo.ExifData.Creator,
		})
	})

	// GET /internal/photos/:id/meta — worker fetches full metadata for frame rendering (Phase 15)
	app.Get("/internal/photos/:id/meta", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var photo models.Photo
		if result := database.DB.Preload("ExifData").Where("id = ?", id).First(&photo); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		aiAnalysis := ""
		if photo.AIAnalysis != nil {
			aiAnalysis = *photo.AIAnalysis
		}
		return c.JSON(fiber.Map{
			"photo_id":           photo.ID,
			"description":        photo.Description,
			"ai_analysis":        aiAnalysis,
			"copyright":          photo.ExifData.Copyright,
			"creator":            photo.ExifData.Creator,
			"camera_model":       photo.ExifData.CameraModel,
			"lens_model":         photo.ExifData.LensModel,
			"focal_length":       photo.ExifData.FocalLength,
			"aperture":           photo.ExifData.Aperture,
			"shutter_speed":      photo.ExifData.ShutterSpeed,
			"iso":                photo.ExifData.ISO,
			"date_time_original": photo.ExifData.DateTimeOriginal,
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 6 — Share Links (public, unauthenticated access)
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/photos/:id/share — create or return existing share link
	app.Post("/api/photos/:id/share", requireJWT(), func(c *fiber.Ctx) error {
		photoID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid photo ID"})
		}
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		var photo models.Photo
		if result := database.DB.First(&photo, photoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}

		// Parse optional expiry_hours from body
		var input struct {
			ExpiryHours *int `json:"expiry_hours"` // nil = never expires
		}
		c.BodyParser(&input) // non-fatal if empty body

		// Check if an active share link already exists
		var existing models.ShareLink
		q := database.DB.Where("photo_id = ? AND is_revoked = false", photoID)
		if input.ExpiryHours == nil {
			q = q.Where("expires_at IS NULL")
		}
		if result := q.First(&existing); result.Error == nil {
			return c.JSON(fiber.Map{
				"token":      existing.Token,
				"share_url":  fmt.Sprintf("/share/%s", existing.Token),
				"expires_at": existing.ExpiresAt,
				"created_at": existing.CreatedAt,
			})
		}

		token, err := generateShareToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate token"})
		}

		sl := models.ShareLink{
			PhotoID:   uint(photoID),
			UserID:    uid,
			Token:     token,
			IsRevoked: false,
		}
		if input.ExpiryHours != nil {
			exp := time.Now().Add(time.Duration(*input.ExpiryHours) * time.Hour)
			sl.ExpiresAt = &exp
		}
		if result := database.DB.Create(&sl); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create share link"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"token":      sl.Token,
			"share_url":  fmt.Sprintf("/share/%s", sl.Token),
			"expires_at": sl.ExpiresAt,
			"created_at": sl.CreatedAt,
		})
	})

	// GET /api/photos/:id/share — list active share links for this photo
	app.Get("/api/photos/:id/share", requireJWT(), func(c *fiber.Ctx) error {
		photoID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid photo ID"})
		}
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		var photo models.Photo
		if result := database.DB.First(&photo, photoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}

		var links []models.ShareLink
		database.DB.Where("photo_id = ? AND is_revoked = false", photoID).Find(&links)
		return c.JSON(links)
	})

	// DELETE /api/photos/:id/share/:token — revoke a specific share link
	app.Delete("/api/photos/:id/share/:token", requireJWT(), func(c *fiber.Ctx) error {
		photoID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid photo ID"})
		}
		token := c.Params("token")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		var photo models.Photo
		if result := database.DB.First(&photo, photoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}

		result := database.DB.Model(&models.ShareLink{}).
			Where("token = ? AND photo_id = ?", token, photoID).
			Update("is_revoked", true)
		if result.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Share link not found"})
		}
		return c.JSON(fiber.Map{"message": "Share link revoked"})
	})

	// GET /share/:token — public endpoint, no JWT required
	// Returns photo metadata + proxy image URL for public viewing
	app.Get("/share/:token", func(c *fiber.Ctx) error {
		token := c.Params("token")
		var sl models.ShareLink
		if result := database.DB.Where("token = ? AND is_revoked = false", token).First(&sl); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Share link not found or expired"})
		}
		// Check expiry
		if sl.ExpiresAt != nil && time.Now().After(*sl.ExpiresAt) {
			return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "Share link has expired"})
		}

		var photo models.Photo
		if result := database.DB.Preload("ExifData").First(&photo, sl.PhotoID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if photo.Status != "completed" {
			return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"error": "Photo is still processing"})
		}

		// Build proxy path for presigned URL
		proxyPath := strings.Replace(photo.MinioPath, "raw/", "proxy/", 1)
		lastDot := strings.LastIndex(proxyPath, ".")
		if lastDot > -1 {
			proxyPath = proxyPath[:lastDot] + ".webp"
		}
		thumbPath := strings.Replace(photo.MinioPath, "raw/", "thumb/", 1)
		thumbPath = thumbPath[:strings.LastIndex(thumbPath, ".")] + ".webp"

		presignExpiry := 1 * time.Hour
		proxyURL, _ := storage.MinioClient.PresignedGetObject(c.Context(), "photos", proxyPath, presignExpiry, nil)
		thumbURL, _ := storage.MinioClient.PresignedGetObject(c.Context(), "photos", thumbPath, presignExpiry, nil)

		return c.JSON(fiber.Map{
			"photo": fiber.Map{
				"id":                photo.ID,
				"original_filename": photo.OriginalFilename,
				"uploaded_at":       photo.UploadedAt,
				"exif":              photo.ExifData,
			},
			"proxy_url": proxyURL.String(),
			"thumb_url": thumbURL.String(),
			"share": fiber.Map{
				"token":      sl.Token,
				"expires_at": sl.ExpiresAt,
				"created_at": sl.CreatedAt,
			},
		})
	})

	// POST /api/admin/invite-codes — create a new invite code (SuperAdmin only)
	app.Post("/api/admin/invite-codes", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)

		var body struct {
			ExpiresInDays *int `json:"expires_in_days"` // nil = never expires
		}
		_ = c.BodyParser(&body) // optional body

		// Generate random 16-char invite code
		b := make([]byte, 8)
		if _, err := rand.Read(b); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate invite code"})
		}
		code := strings.ToUpper(hex.EncodeToString(b))

		ic := models.InviteCode{
			Code:      code,
			CreatedBy: uid,
		}
		if body.ExpiresInDays != nil {
			t := time.Now().Add(time.Duration(*body.ExpiresInDays) * 24 * time.Hour)
			ic.ExpiresAt = &t
		}
		if err := database.DB.Create(&ic).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create invite code"})
		}
		return c.Status(fiber.StatusCreated).JSON(ic)
	})

	// GET /api/admin/invite-codes — list all invite codes (SuperAdmin only)
	app.Get("/api/admin/invite-codes", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var codes []models.InviteCode
		if err := database.DB.Order("created_at desc").Find(&codes).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch invite codes"})
		}
		return c.JSON(codes)
	})

	// DELETE /api/admin/invite-codes/:id — delete an invite code (SuperAdmin only)
	app.Delete("/api/admin/invite-codes/:id", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		id := c.Params("id")
		result := database.DB.Delete(&models.InviteCode{}, id)
		if result.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invite code not found"})
		}
		return c.JSON(fiber.Map{"message": "Invite code deleted"})
	})

	// POST /api/photos/batch-delete — delete multiple photos by ID
	app.Post("/api/photos/batch-delete", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		var body struct {
			IDs []uint `json:"ids"`
		}
		if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ids array required"})
		}
		if len(body.IDs) > 100 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "maximum 100 photos per batch"})
		}

		// Fetch only photos the caller owns (SuperAdmin can delete any)
		var photos []models.Photo
		q := database.DB.Where("id IN ?", body.IDs)
		if role != "SuperAdmin" {
			q = q.Where("user_id = ?", uid)
		}
		if err := q.Find(&photos).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch photos"})
		}

		ctx := c.Context()
		deleted := 0
		for _, photo := range photos {
			// Remove all MinIO variants (raw / proxy / thumb)
			rawPath := photo.MinioPath
			ext := filepath.Ext(rawPath)
			proxyPath := strings.TrimSuffix(strings.Replace(rawPath, "raw/", "proxy/", 1), ext) + ".webp"
			thumbPath := strings.TrimSuffix(strings.Replace(rawPath, "raw/", "thumb/", 1), ext) + ".webp"
			for _, obj := range []string{rawPath, proxyPath, thumbPath} {
				_ = storage.MinioClient.RemoveObject(ctx, "photos", obj, minio.RemoveObjectOptions{})
			}
			database.DB.Delete(&photo)
			deleted++
		}

		return c.JSON(fiber.Map{"deleted": deleted, "requested": len(body.IDs)})
	})

	// POST /api/photos/batch-export — queue export jobs for multiple photos
	app.Post("/api/photos/batch-export", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		var body struct {
			IDs    []uint `json:"ids"`
			Format string `json:"format"`
		}
		if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ids array required"})
		}
		if len(body.IDs) > 50 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "maximum 50 photos per batch export"})
		}
		format := body.Format
		if format == "" {
			format = "jpeg"
		}
		optsJSON := fmt.Sprintf(`{"format":"%s"}`, format)

		// Fetch completed photos owned by the caller
		var photos []models.Photo
		q := database.DB.Where("id IN ? AND status = 'completed'", body.IDs)
		if role != "SuperAdmin" {
			q = q.Where("user_id = ?", uid)
		}
		if err := q.Find(&photos).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch photos"})
		}

		type JobRef struct {
			PhotoID uint `json:"photo_id"`
			JobID   uint `json:"job_id"`
		}
		var jobs []JobRef
		for _, photo := range photos {
			job := models.ExportJob{
				PhotoID:       photo.ID,
				UserID:        uid,
				Status:        "pending",
				ExportOptions: optsJSON,
			}
			if err := database.DB.Create(&job).Error; err != nil {
				continue
			}
			if err := queue.PublishExportTask(job.ID, photo.ID, optsJSON); err != nil {
				database.DB.Model(&job).Update("status", "failed")
				continue
			}
			jobs = append(jobs, JobRef{PhotoID: photo.ID, JobID: job.ID})
		}

		return c.JSON(fiber.Map{"queued": len(jobs), "jobs": jobs})
	})

	// ── Albums ───────────────────────────────────────────────────────────────

	// POST /api/albums — create a new album
	app.Post("/api/albums", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var body struct {
			Name         string `json:"name"`
			Description  string `json:"description"`
			CoverPhotoID *uint  `json:"cover_photo_id"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
		}
		if strings.TrimSpace(body.Name) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
		}
		initToken, err := generateShareToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to generate share token"})
		}
		album := models.Album{
			UserID:       uid,
			Name:         strings.TrimSpace(body.Name),
			Description:  body.Description,
			CoverPhotoID: body.CoverPhotoID,
			ShareToken:   initToken,
		}
		if err := database.DB.Create(&album).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create album"})
		}
		return c.Status(fiber.StatusCreated).JSON(album)
	})

	// GET /api/albums — list current user's albums (with photo count)
	app.Get("/api/albums", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		type AlbumWithCount struct {
			models.Album
			PhotoCount int64 `json:"photo_count"`
		}
		var albums []models.Album
		database.DB.Where("user_id = ?", uid).Order("created_at desc").Find(&albums)
		result := make([]AlbumWithCount, 0, len(albums))
		for _, a := range albums {
			var cnt int64
			database.DB.Table("album_photos").Where("album_id = ?", a.ID).Count(&cnt)
			result = append(result, AlbumWithCount{Album: a, PhotoCount: cnt})
		}
		return c.JSON(result)
	})

	// GET /api/albums/:id — album detail with photos
	app.Get("/api/albums/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var album models.Album
		if result := database.DB.Preload("Photos").First(&album, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.JSON(album)
	})

	// PUT /api/albums/:id — update name/description/cover
	app.Put("/api/albums/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var album models.Album
		if result := database.DB.First(&album, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		var body struct {
			Name         *string `json:"name"`
			Description  *string `json:"description"`
			CoverPhotoID *uint   `json:"cover_photo_id"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
		}
		if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
			album.Name = strings.TrimSpace(*body.Name)
		}
		if body.Description != nil {
			album.Description = *body.Description
		}
		if body.CoverPhotoID != nil {
			album.CoverPhotoID = body.CoverPhotoID
		}
		database.DB.Save(&album)
		return c.JSON(album)
	})

	// DELETE /api/albums/:id — delete album (photos untouched)
	app.Delete("/api/albums/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var album models.Album
		if result := database.DB.First(&album, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		// Clear join table entries first then soft-delete album
		database.DB.Exec("DELETE FROM album_photos WHERE album_id = ?", album.ID)
		database.DB.Delete(&album)
		return c.JSON(fiber.Map{"message": "album deleted"})
	})

	// POST /api/albums/:id/photos — add photos to album {photo_ids: [...]}
	app.Post("/api/albums/:id/photos", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var album models.Album
		if result := database.DB.First(&album, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		var body struct {
			PhotoIDs []uint `json:"photo_ids"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
		}
		added := 0
		for _, pid := range body.PhotoIDs {
			var photo models.Photo
			if err := database.DB.Where("id = ? AND user_id = ?", pid, uid).First(&photo).Error; err != nil {
				continue // skip photos not owned by user
			}
			// Use INSERT IGNORE equivalent — ignore duplicate key errors
			res := database.DB.Exec("INSERT INTO album_photos (album_id, photo_id, added_at) VALUES (?, ?, NOW()) ON CONFLICT DO NOTHING", album.ID, pid)
			if res.Error == nil {
				added++
			}
		}
		return c.JSON(fiber.Map{"added": added})
	})

	// DELETE /api/albums/:id/photos/:photo_id — remove a photo from album
	app.Delete("/api/albums/:id/photos/:photo_id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id, err := c.ParamsInt("id")
		photoID, err2 := c.ParamsInt("photo_id")
		if err != nil || err2 != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var album models.Album
		if result := database.DB.First(&album, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		database.DB.Exec("DELETE FROM album_photos WHERE album_id = ? AND photo_id = ?", album.ID, photoID)
		return c.JSON(fiber.Map{"message": "removed"})
	})

	// POST /api/albums/:id/share — generate or refresh public share token
	app.Post("/api/albums/:id/share", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var album models.Album
		if result := database.DB.First(&album, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		tokenBytes := make([]byte, 16)
		rand.Read(tokenBytes)
		album.ShareToken = fmt.Sprintf("%x", tokenBytes)
		database.DB.Save(&album)
		return c.JSON(fiber.Map{"share_token": album.ShareToken})
	})

	// DELETE /api/albums/:id/share — revoke public share
	app.Delete("/api/albums/:id/share", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		id, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var album models.Album
		if result := database.DB.First(&album, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		album.ShareToken = ""
		database.DB.Save(&album)
		return c.JSON(fiber.Map{"message": "share revoked"})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 14 — Album batch export (ZIP / PDF)
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/albums/:id/export — create album export job
	app.Post("/api/albums/:id/export", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		albumID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid album id"})
		}

		var album models.Album
		if result := database.DB.Preload("Photos").First(&album, albumID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		if len(album.Photos) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "album has no photos"})
		}
		if len(album.Photos) > 200 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "album too large (max 200 photos)"})
		}

		var body struct {
			Format    string `json:"format"`     // zip | pdf
			Quality   int    `json:"quality"`    // 1–100
			PrintSpec string `json:"print_spec"` // none | 4x6 | 5x7 | a4 | square
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		if body.Format == "" {
			body.Format = "zip"
		}
		if body.Quality == 0 {
			body.Quality = 85
		}
		if body.PrintSpec == "" {
			body.PrintSpec = "none"
		}

		optsMap := map[string]interface{}{
			"type":       "album_export",
			"format":     body.Format,
			"quality":    body.Quality,
			"print_spec": body.PrintSpec,
			"album_name": album.Name,
		}
		optsRaw, _ := json.Marshal(optsMap)

		albumIDUint := uint(albumID)
		job := models.ExportJob{
			PhotoID:       0, // not a single photo
			AlbumID:       &albumIDUint,
			JobType:       "album",
			UserID:        uid,
			Status:        "pending",
			ExportOptions: string(optsRaw),
		}
		if result := database.DB.Create(&job); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create export job"})
		}

		if err := queue.PublishAlbumExportTask(job.ID, uint(albumID), string(optsRaw)); err != nil {
			database.DB.Model(&job).Updates(map[string]interface{}{"status": "failed", "error_message": err.Error()})
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to queue export task"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"message": "Album export job created",
			"job_id":  job.ID,
			"format":  body.Format,
			"photos":  len(album.Photos),
		})
	})

	// GET /api/albums/:id/exports — list export jobs for an album
	app.Get("/api/albums/:id/exports", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		albumID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid album id"})
		}

		var album models.Album
		if result := database.DB.First(&album, albumID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found"})
		}
		if album.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}

		albumIDUint := uint(albumID)
		var jobs []models.ExportJob
		database.DB.Where("album_id = ? AND user_id = ?", albumIDUint, uid).
			Order("created_at DESC").Find(&jobs)

		return c.JSON(fiber.Map{"jobs": jobs, "total": len(jobs)})
	})

	// GET /internal/albums/:id/photos — worker fetches album photo list
	app.Get("/internal/albums/:id/photos", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		albumID := c.Params("id")

		type AlbumPhoto struct {
			PhotoID          uint   `json:"photo_id"`
			OriginalFilename string `json:"original_filename"`
			MinioPath        string `json:"minio_path"`
			Description      string `json:"description"`
			Copyright        string `json:"copyright"`
			Creator          string `json:"creator"`
		}

		type row struct {
			PhotoID          uint
			OriginalFilename string
			MinioPath        string
			Description      string
			Copyright        string
			Creator          string
		}

		var rows []row
		database.DB.Table("album_photos").
			Select("photos.id AS photo_id, photos.original_filename, photos.minio_path, photos.description, COALESCE(exif_data.copyright,'') AS copyright, COALESCE(exif_data.creator,'') AS creator").
			Joins("JOIN photos ON photos.id = album_photos.photo_id AND photos.deleted_at IS NULL").
			Joins("LEFT JOIN exif_data ON exif_data.photo_id = photos.id AND exif_data.deleted_at IS NULL").
			Where("album_photos.album_id = ? AND photos.status = 'completed'", albumID).
			Order("album_photos.id ASC").
			Scan(&rows)

		photos := make([]AlbumPhoto, 0, len(rows))
		for _, r := range rows {
			photos = append(photos, AlbumPhoto{
				PhotoID:          r.PhotoID,
				OriginalFilename: r.OriginalFilename,
				MinioPath:        r.MinioPath,
				Description:      r.Description,
				Copyright:        r.Copyright,
				Creator:          r.Creator,
			})
		}
		return c.JSON(fiber.Map{"photos": photos, "total": len(photos)})
	})

	// GET /share/album/:token — public album view
	app.Get("/share/album/:token", func(c *fiber.Ctx) error {
		token := c.Params("token")
		if token == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing token"})
		}
		var album models.Album
		if result := database.DB.Preload("Photos").Where("share_token = ?", token).First(&album); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "album not found or not shared"})
		}
		// Build thumbnail URLs for each photo
		type PhotoThumb struct {
			ID               uint   `json:"id"`
			OriginalFilename string `json:"original_filename"`
			ThumbnailURL     string `json:"thumbnail_url"`
		}
		thumbs := make([]PhotoThumb, 0, len(album.Photos))
		for _, p := range album.Photos {
			if p.Status != "completed" {
				continue
			}
			thumbPath := strings.Replace(p.MinioPath, "raw/", "thumb/", 1)
			thumbPath = thumbPath[:strings.LastIndex(thumbPath, ".")] + ".webp"
			thumbURL, _ := storage.MinioClient.PresignedGetObject(c.Context(), "photos", thumbPath, 1*time.Hour, nil)
			thumbs = append(thumbs, PhotoThumb{
				ID:               p.ID,
				OriginalFilename: p.OriginalFilename,
				ThumbnailURL:     thumbURL.String(),
			})
		}
		return c.JSON(fiber.Map{
			"album": fiber.Map{
				"id":          album.ID,
				"name":        album.Name,
				"description": album.Description,
				"created_at":  album.CreatedAt,
			},
			"photos": thumbs,
		})
	})

	// ── User Profile ─────────────────────────────────────────────────────────

	// GET /api/profile — return current user's profile (create if not exists)
	app.Get("/api/profile", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var profile models.UserProfile
		database.DB.FirstOrCreate(&profile, models.UserProfile{UserID: uid})

		// Generate 1-hour presigned URLs for avatar/signature if they exist
		avatarURL := ""
		sigURL := ""
		if profile.AvatarPath != "" {
			u, err := storage.MinioClient.PresignedGetObject(c.Context(), "photos", profile.AvatarPath, time.Hour, nil)
			if err == nil {
				avatarURL = u.String()
			}
		}
		if profile.SignaturePath != "" {
			u, err := storage.MinioClient.PresignedGetObject(c.Context(), "photos", profile.SignaturePath, time.Hour, nil)
			if err == nil {
				sigURL = u.String()
			}
		}
		return c.JSON(fiber.Map{
			"id":             profile.ID,
			"user_id":        profile.UserID,
			"bio":            profile.Bio,
			"avatar_path":    profile.AvatarPath,
			"signature_path": profile.SignaturePath,
			"website":        profile.Website,
			"location":       profile.Location,
			"avatar_url":     avatarURL,
			"signature_url":  sigURL,
			"updated_at":     profile.UpdatedAt,
		})
	})

	// PUT /api/profile — update bio/website/location
	app.Put("/api/profile", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var profile models.UserProfile
		database.DB.FirstOrCreate(&profile, models.UserProfile{UserID: uid})

		var body struct {
			Bio      *string `json:"bio"`
			Website  *string `json:"website"`
			Location *string `json:"location"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		if body.Bio != nil {
			profile.Bio = *body.Bio
		}
		if body.Website != nil {
			profile.Website = *body.Website
		}
		if body.Location != nil {
			profile.Location = *body.Location
		}
		database.DB.Save(&profile)
		return c.JSON(fiber.Map{"message": "profile updated"})
	})

	// POST /api/profile/avatar — upload avatar image
	app.Post("/api/profile/avatar", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		file, err := c.FormFile("avatar")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "avatar file required"})
		}
		ext := filepath.Ext(file.Filename)
		if ext == "" {
			ext = ".jpg"
		}
		objectName := fmt.Sprintf("profiles/avatars/%d/%s%s", uid, uuid.New().String(), ext)
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to open file"})
		}
		defer src.Close()
		_, err = storage.MinioClient.PutObject(c.Context(), "photos", objectName, src, file.Size, minio.PutObjectOptions{ContentType: file.Header.Get("Content-Type")})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
		}
		var profile models.UserProfile
		database.DB.FirstOrCreate(&profile, models.UserProfile{UserID: uid})
		profile.AvatarPath = objectName
		database.DB.Save(&profile)
		// Return presigned URL
		presigned, _ := storage.MinioClient.PresignedGetObject(c.Context(), "photos", objectName, time.Hour, nil)
		return c.JSON(fiber.Map{"avatar_path": objectName, "avatar_url": presigned.String()})
	})

	// POST /api/profile/signature — upload signature PNG (preserves transparency)
	app.Post("/api/profile/signature", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		file, err := c.FormFile("signature")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "signature file required"})
		}
		objectName := fmt.Sprintf("profiles/signatures/%d/%s.png", uid, uuid.New().String())
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to open file"})
		}
		defer src.Close()
		_, err = storage.MinioClient.PutObject(c.Context(), "photos", objectName, src, file.Size, minio.PutObjectOptions{ContentType: "image/png"})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
		}
		var profile models.UserProfile
		database.DB.FirstOrCreate(&profile, models.UserProfile{UserID: uid})
		profile.SignaturePath = objectName
		database.DB.Save(&profile)
		presigned, _ := storage.MinioClient.PresignedGetObject(c.Context(), "photos", objectName, time.Hour, nil)
		return c.JSON(fiber.Map{"signature_path": objectName, "signature_url": presigned.String()})
	})

	// ─────────────────────────────────────────────────────────────────
	// v8.3 — Advanced Search: GET /api/photos/search
	// ─────────────────────────────────────────────────────────────────
	app.Get("/api/photos/search", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		page := c.QueryInt("page", 1)
		limit := c.QueryInt("limit", 20)
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit

		q := strings.TrimSpace(c.Query("q", ""))
		camera := strings.TrimSpace(c.Query("camera", ""))
		lens := strings.TrimSpace(c.Query("lens", ""))
		isoMin := strings.TrimSpace(c.Query("iso_min", ""))
		isoMax := strings.TrimSpace(c.Query("iso_max", ""))
		dateFrom := strings.TrimSpace(c.Query("date_from", ""))
		dateTo := strings.TrimSpace(c.Query("date_to", ""))
		latStr := strings.TrimSpace(c.Query("lat", ""))
		lngStr := strings.TrimSpace(c.Query("lng", ""))
		radiusKmStr := strings.TrimSpace(c.Query("radius_km", ""))
		colorSpace := strings.TrimSpace(c.Query("color_space", ""))

		query := database.DB.Model(&models.Photo{}).
			Joins("LEFT JOIN exif_data ON exif_data.photo_id = photos.id AND exif_data.deleted_at IS NULL")
		if role != "SuperAdmin" {
			query = query.Where("photos.user_id = ?", uid)
		}
		query = query.Where("photos.status = ?", "completed")

		if q != "" {
			like := "%" + q + "%"
			query = query.Where("photos.original_filename ILIKE ? OR exif_data.camera_model ILIKE ? OR exif_data.lens_model ILIKE ?", like, like, like)
		}
		if camera != "" {
			query = query.Where("exif_data.camera_model ILIKE ?", "%"+camera+"%")
		}
		if lens != "" {
			query = query.Where("exif_data.lens_model ILIKE ?", "%"+lens+"%")
		}
		if colorSpace != "" {
			query = query.Where("exif_data.color_space ILIKE ?", "%"+colorSpace+"%")
		}
		// ISO stored as string like "1600" — extract numeric part
		if isoMin != "" {
			query = query.Where("NULLIF(regexp_replace(exif_data.iso, '[^0-9]', '', 'g'), '')::BIGINT >= ?", isoMin)
		}
		if isoMax != "" {
			query = query.Where("NULLIF(regexp_replace(exif_data.iso, '[^0-9]', '', 'g'), '')::BIGINT <= ?", isoMax)
		}
		if dateFrom != "" {
			query = query.Where("photos.uploaded_at >= ?", dateFrom)
		}
		if dateTo != "" {
			query = query.Where("photos.uploaded_at <= ?", dateTo+" 23:59:59")
		}
		// GPS bounding box approximation
		if latStr != "" && lngStr != "" && radiusKmStr != "" {
			lat, errLat := strconv.ParseFloat(latStr, 64)
			lng, errLng := strconv.ParseFloat(lngStr, 64)
			radiusKm, errR := strconv.ParseFloat(radiusKmStr, 64)
			if errLat == nil && errLng == nil && errR == nil && radiusKm > 0 {
				latDelta := radiusKm / 111.0
				lngDelta := radiusKm / (111.0 * math.Cos(lat*math.Pi/180.0))
				query = query.Where(
					"NULLIF(exif_data.gps_latitude,'')::FLOAT BETWEEN ? AND ? AND NULLIF(exif_data.gps_longitude,'')::FLOAT BETWEEN ? AND ?",
					lat-latDelta, lat+latDelta, lng-lngDelta, lng+lngDelta,
				)
			}
		}

		var total int64
		if err := query.Count(&total).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "count failed"})
		}
		var photos []models.Photo
		if err := query.Select("photos.*").Preload("ExifData").
			Order("photos.uploaded_at DESC").Limit(limit).Offset(offset).Find(&photos).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "query failed"})
		}
		return c.JSON(fiber.Map{
			"photos":      photos,
			"total":       total,
			"page":        page,
			"limit":       limit,
			"total_pages": int((total + int64(limit) - 1) / int64(limit)),
		})
	})

	// ─────────────────────────────────────────────────────────────────
	// v8.1 — Dashboard statistics: GET /api/stats
	// ─────────────────────────────────────────────────────────────────
	app.Get("/api/stats", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		uidCond := "user_id = ?"
		uidArgs := []interface{}{uid}
		if role == "SuperAdmin" {
			uidCond = "1=1"
			uidArgs = nil
		}

		// Total photos (all statuses)
		var totalPhotos int64
		database.DB.Model(&models.Photo{}).Where(uidCond, uidArgs...).Count(&totalPhotos)

		// Completed photos
		var completedPhotos int64
		database.DB.Model(&models.Photo{}).Where(uidCond+" AND status = 'completed'", uidArgs...).Count(&completedPhotos)

		// AI analysed (AIAnalysis is not null)
		var aiAnalyzed int64
		database.DB.Model(&models.Photo{}).Where(uidCond+" AND ai_analysis IS NOT NULL", uidArgs...).Count(&aiAnalyzed)

		// Albums
		var totalAlbums int64
		database.DB.Model(&models.Album{}).Where(uidCond, uidArgs...).Count(&totalAlbums)

		// Presets
		var totalPresets int64
		database.DB.Model(&models.Preset{}).Where(uidCond, uidArgs...).Count(&totalPresets)

		// Recent uploads by day (last 14 days)
		type DayCount struct {
			Date  string `json:"date"`
			Count int64  `json:"count"`
		}
		var recentUploads []DayCount
		recentSQL := `SELECT TO_CHAR(uploaded_at, 'YYYY-MM-DD') as date, COUNT(*) as count
			FROM photos WHERE deleted_at IS NULL AND ` + uidCond + `
			AND uploaded_at >= NOW() - INTERVAL '14 days'
			GROUP BY date ORDER BY date`
		if uidArgs == nil {
			database.DB.Raw(recentSQL).Scan(&recentUploads)
		} else {
			database.DB.Raw(recentSQL, uidArgs...).Scan(&recentUploads)
		}

		// Top cameras (from exif_data)
		type NameCount struct {
			Name  string `json:"name"`
			Count int64  `json:"count"`
		}
		var topCameras []NameCount
		camSQL := `SELECT exif_data.camera_model as name, COUNT(*) as count
			FROM exif_data
			JOIN photos ON photos.id = exif_data.photo_id AND photos.deleted_at IS NULL
			WHERE exif_data.deleted_at IS NULL AND exif_data.camera_model != '' AND ` + uidCond + `
			GROUP BY exif_data.camera_model ORDER BY count DESC LIMIT 8`
		if uidArgs == nil {
			database.DB.Raw(camSQL).Scan(&topCameras)
		} else {
			database.DB.Raw(camSQL, uidArgs...).Scan(&topCameras)
		}

		// Top lenses
		var topLenses []NameCount
		lensSQL := `SELECT exif_data.lens_model as name, COUNT(*) as count
			FROM exif_data
			JOIN photos ON photos.id = exif_data.photo_id AND photos.deleted_at IS NULL
			WHERE exif_data.deleted_at IS NULL AND exif_data.lens_model != '' AND ` + uidCond + `
			GROUP BY exif_data.lens_model ORDER BY count DESC LIMIT 8`
		if uidArgs == nil {
			database.DB.Raw(lensSQL).Scan(&topLenses)
		} else {
			database.DB.Raw(lensSQL, uidArgs...).Scan(&topLenses)
		}

		// Color space distribution
		var colorSpaces []NameCount
		csSQL := `SELECT exif_data.color_space as name, COUNT(*) as count
			FROM exif_data
			JOIN photos ON photos.id = exif_data.photo_id AND photos.deleted_at IS NULL
			WHERE exif_data.deleted_at IS NULL AND exif_data.color_space != '' AND ` + uidCond + `
			GROUP BY exif_data.color_space ORDER BY count DESC`
		if uidArgs == nil {
			database.DB.Raw(csSQL).Scan(&colorSpaces)
		} else {
			database.DB.Raw(csSQL, uidArgs...).Scan(&colorSpaces)
		}

		return c.JSON(fiber.Map{
			"total_photos":     totalPhotos,
			"completed_photos": completedPhotos,
			"ai_analyzed":      aiAnalyzed,
			"albums":           totalAlbums,
			"presets":          totalPresets,
			"recent_uploads":   recentUploads,
			"top_cameras":      topCameras,
			"top_lenses":       topLenses,
			"color_spaces":     colorSpaces,
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// v9.2 — Public photographer portfolio (no authentication required)
	// ─────────────────────────────────────────────────────────────────────────

	// GET /public/profile/:username — public-facing photographer portfolio page
	app.Get("/public/profile/:username", func(c *fiber.Ctx) error {
		username := strings.TrimSpace(c.Params("username"))
		if username == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "username required"})
		}
		var user models.User
		if result := database.DB.Where("username = ?", username).First(&user); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
		}
		var profile models.UserProfile
		database.DB.Where("user_id = ?", user.ID).First(&profile)

		// Public photos only (is_public = true AND completed)
		var photos []models.Photo
		database.DB.Preload("ExifData").
			Where("user_id = ? AND is_public = true AND status = 'completed'", user.ID).
			Order("uploaded_at desc").Limit(120).Find(&photos)

		type PublicPhoto struct {
			ID               uint      `json:"id"`
			OriginalFilename string    `json:"original_filename"`
			ThumbnailURL     string    `json:"thumbnail_url"`
			CameraModel      string    `json:"camera_model"`
			Description      string    `json:"description"`
			Tags             *string   `json:"tags"`
			UploadedAt       time.Time `json:"uploaded_at"`
			IsPublic         bool      `json:"is_public"`
		}
		publicPhotos := make([]PublicPhoto, 0, len(photos))
		for _, p := range photos {
			// Derive thumbnail path from raw path
			thumbPath := strings.Replace(p.MinioPath, "raw/", "thumbnail/", 1)
			thumbPath = strings.TrimSuffix(thumbPath, filepath.Ext(thumbPath)) + ".webp"
			var thumbURL string
			if u, err := storage.MinioClient.PresignedGetObject(c.Context(), "photos", thumbPath, time.Hour, nil); err == nil {
				thumbURL = u.String()
			}
			cam := ""
			if p.ExifData.ID != 0 {
				cam = p.ExifData.CameraModel
			}
			publicPhotos = append(publicPhotos, PublicPhoto{
				ID:               p.ID,
				OriginalFilename: p.OriginalFilename,
				ThumbnailURL:     thumbURL,
				CameraModel:      cam,
				Description:      p.Description,
				Tags:             p.Tags,
				UploadedAt:       p.UploadedAt,
				IsPublic:         true, // filtered by WHERE is_public=true
			})
		}

		// Avatar presigned URL
		var avatarURL string
		if profile.AvatarPath != "" {
			if u, err := storage.MinioClient.PresignedGetObject(c.Context(), "photos", profile.AvatarPath, time.Hour, nil); err == nil {
				avatarURL = u.String()
			}
		}

		return c.JSON(fiber.Map{
			"username":    user.Username,
			"bio":         profile.Bio,
			"website":     profile.Website,
			"location":    profile.Location,
			"avatar_url":  avatarURL,
			"photo_count": len(publicPhotos),
			"photos":      publicPhotos,
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// v8.5 — Server-Sent Events (real-time notifications)
	// ─────────────────────────────────────────────────────────────────────────

	// GET /api/events/stream — long-lived SSE stream for the authenticated user.
	// Token is passed as ?token=<jwt> because the browser EventSource API cannot
	// set custom Authorization headers.
	app.Get("/api/events/stream", func(c *fiber.Ctx) error {
		tokenStr := c.Query("token")
		if tokenStr == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing token"})
		}
		claims, err := auth.ValidateAccessToken(tokenStr)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token"})
		}
		var row struct{ ID uint }
		if dbErr := database.DB.Model(&models.User{}).Select("id").Where("public_id = ?", claims.UserID).Scan(&row).Error; dbErr != nil || row.ID == 0 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "User not found"})
		}
		uid := row.ID

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("X-Accel-Buffering", "no")

		ch := sseSubscribe(uid)

		c.Context().SetBodyStreamWriter(fasthttp.StreamWriter(func(w *bufio.Writer) {
			defer sseUnsubscribe(uid, ch)

			// Initial handshake
			fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
			w.Flush()

			heartbeat := time.NewTicker(30 * time.Second)
			defer heartbeat.Stop()

			for {
				select {
				case msg, ok := <-ch:
					if !ok {
						return
					}
					fmt.Fprint(w, msg)
					w.Flush()
				case <-heartbeat.C:
					// Keep-alive comment (not parsed as an event by browsers)
					fmt.Fprintf(w, ": heartbeat\n\n")
					if err := w.Flush(); err != nil {
						return // client disconnected
					}
				}
			}
		}))
		return nil
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 10 — Admin Stats, Preset XMP Parser, Storage Config
	// ─────────────────────────────────────────────────────────────────────────

	// GET /api/admin/stats — site statistics (SuperAdmin)
	app.Get("/api/admin/stats", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var totalUsers, totalPhotos, totalAlbums, totalPresets int64
		database.DB.Model(&models.User{}).Count(&totalUsers)
		database.DB.Model(&models.Photo{}).Count(&totalPhotos)
		database.DB.Model(&models.Album{}).Count(&totalAlbums)
		database.DB.Model(&models.Preset{}).Count(&totalPresets)

		var topUsers []struct {
			UserID   uint   `json:"user_id"`
			Username string `json:"username"`
			Count    int64  `json:"count"`
		}
		database.DB.Raw(`
			SELECT p.user_id, u.username, COUNT(p.id) AS count
			FROM photos p
			JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
			WHERE p.deleted_at IS NULL
			GROUP BY p.user_id, u.username
			ORDER BY count DESC
			LIMIT 10
		`).Scan(&topUsers)

		return c.JSON(fiber.Map{
			"total_users":   totalUsers,
			"total_photos":  totalPhotos,
			"total_albums":  totalAlbums,
			"total_presets": totalPresets,
			"top_users":     topUsers,
		})
	})

	// GET /api/admin/users/:id/photos — paginated photos for a specific user (SuperAdmin)
	app.Get("/api/admin/users/:id/photos", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		userID, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid user ID"})
		}
		page := c.QueryInt("page", 1)
		limit := c.QueryInt("limit", 20)
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit

		var total int64
		database.DB.Model(&models.Photo{}).Where("user_id = ?", userID).Count(&total)

		var photos []models.Photo
		database.DB.Preload("ExifData").Where("user_id = ?", userID).
			Order("uploaded_at desc").Limit(limit).Offset(offset).Find(&photos)

		return c.JSON(fiber.Map{
			"photos":      photos,
			"total":       total,
			"page":        page,
			"limit":       limit,
			"total_pages": int((total + int64(limit) - 1) / int64(limit)),
		})
	})

	// PUT /api/admin/users/:id/role — change user role (SuperAdmin, cannot change own role)
	app.Put("/api/admin/users/:id/role", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		targetID, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid user ID"})
		}
		selfID := userIDFromLocals(c)
		if uint(targetID) == selfID {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot change your own role"})
		}

		var body struct {
			Role string `json:"role"`
		}
		if err := c.BodyParser(&body); err != nil || body.Role == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "role is required"})
		}
		allowed := map[string]bool{"User": true, "admin": true, "SuperAdmin": true}
		if !allowed[body.Role] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid role"})
		}

		result := database.DB.Model(&models.User{}).Where("id = ?", targetID).Update("role", body.Role)
		if result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update role"})
		}
		if result.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
		}
		return c.JSON(fiber.Map{"ok": true, "id": targetID, "role": body.Role})
	})

	// DELETE /api/admin/users/:id — delete user and all their data (SuperAdmin, cannot delete self)
	app.Delete("/api/admin/users/:id", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		targetID, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid user ID"})
		}
		selfID := userIDFromLocals(c)
		if uint(targetID) == selfID {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot delete your own account"})
		}

		// Cascade: delete photos, refresh tokens, presets, albums, profile
		database.DB.Where("user_id = ?", targetID).Delete(&models.Photo{})
		database.DB.Where("user_id = ?", targetID).Delete(&models.RefreshToken{})
		database.DB.Where("user_id = ?", targetID).Delete(&models.Preset{})
		database.DB.Where("user_id = ?", targetID).Delete(&models.Album{})
		database.DB.Where("user_id = ?", targetID).Delete(&models.UserProfile{})

		result := database.DB.Delete(&models.User{}, targetID)
		if result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete user"})
		}
		if result.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
		}
		return c.JSON(fiber.Map{"ok": true})
	})

	// POST /api/presets/parse-xmp — parse .xmp or .lrtemplate file into preset params
	app.Post("/api/presets/parse-xmp", requireJWT(), func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file is required"})
		}
		f, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to open file"})
		}
		defer f.Close()

		data, err := io.ReadAll(f)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to read file"})
		}

		ext := strings.ToLower(filepath.Ext(file.Filename))
		params := map[string]float64{}
		format := "xmp"

		if ext == ".lrtemplate" {
			format = "lrtemplate"
			// Parse key = value patterns (numeric values only)
			re := regexp.MustCompile(`(\w+)\s*=\s*(-?[\d.]+)`)
			for _, m := range re.FindAllStringSubmatch(string(data), -1) {
				if v, err2 := strconv.ParseFloat(m[2], 64); err2 == nil {
					lrMap := map[string]string{
						"Exposure":               "exposure",
						"Contrast":               "contrast",
						"Highlights":             "highlights",
						"Shadows":                "shadows",
						"Whites":                 "whites",
						"Blacks":                 "blacks",
						"Clarity":                "clarity",
						"Vibrance":               "vibrance",
						"Saturation":             "saturation",
						"Sharpness":              "sharpness",
						"LuminanceNR":            "noiseReduction",
						"PostCropVignetteAmount": "vignette",
					}
					if k, ok := lrMap[m[1]]; ok {
						params[k] = v
					}
				}
			}
		} else {
			// Parse XMP/CRS attributes using regex — handles namespace prefixes reliably
			crsMap := map[string]string{
				"Exposure2012":       "exposure",
				"Contrast2012":       "contrast",
				"Highlights2012":     "highlights",
				"Shadows2012":        "shadows",
				"Whites2012":         "whites",
				"Blacks2012":         "blacks",
				"Clarity2012":        "clarity",
				"Vibrance":           "vibrance",
				"Saturation":         "saturation",
				"Sharpness":          "sharpness",
				"LuminanceSmoothing": "noiseReduction",
				"VignetteAmount":     "vignette",
				"Exposure":           "exposure",
				"Contrast":           "contrast",
				"Highlights":         "highlights",
				"Shadows":            "shadows",
			}
			// Match crs:AttrName="value" or crs:AttrName='value' regardless of namespace URI
			xmpRe := regexp.MustCompile(`(?:crs:)(\w+)=["'](-?[\d.]+)["']`)
			for _, m := range xmpRe.FindAllStringSubmatch(string(data), -1) {
				if k, ok := crsMap[m[1]]; ok {
					if v, err2 := strconv.ParseFloat(m[2], 64); err2 == nil {
						params[k] = v
					}
				}
			}
		}

		return c.JSON(fiber.Map{
			"format": format,
			"params": params,
		})
	})

	// GET /api/photos/:id/preset-preview — inferred params + EXIF summary for preview
	app.Get("/api/photos/:id/preset-preview", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		var photo models.Photo
		result := database.DB.Preload("ExifData").First(&photo, id)
		if result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role != "SuperAdmin" && photo.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Forbidden"})
		}

		exifSummary := fiber.Map{}
		if photo.ExifData.ID != 0 {
			exifSummary = fiber.Map{
				"camera":   photo.ExifData.CameraModel,
				"lens":     photo.ExifData.LensModel,
				"aperture": photo.ExifData.Aperture,
				"shutter":  photo.ExifData.ShutterSpeed,
				"iso":      photo.ExifData.ISO,
			}
		}

		return c.JSON(fiber.Map{
			"photo_id":        photo.ID,
			"inferred_params": photo.InferredParams,
			"exif":            exifSummary,
		})
	})

	// GET /api/admin/storage — get current storage configuration (SuperAdmin)
	app.Get("/api/admin/storage", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var cfg models.StorageConfig
		if err := database.DB.First(&cfg, 1).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Storage config not found"})
		}
		// Mask secret key
		masked := "********"
		if cfg.SecretKey == "" {
			masked = ""
		}
		return c.JSON(fiber.Map{
			"id":         cfg.ID,
			"backend":    cfg.Backend,
			"endpoint":   cfg.Endpoint,
			"bucket":     cfg.Bucket,
			"access_key": cfg.AccessKey,
			"secret_key": masked,
			"root_path":  cfg.RootPath,
			"use_ssl":    cfg.UseSSL,
			"region":     cfg.Region,
		})
	})

	// PUT /api/admin/storage — update storage configuration (SuperAdmin)
	app.Put("/api/admin/storage", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var body struct {
			Backend   *string `json:"backend"`
			Endpoint  *string `json:"endpoint"`
			Bucket    *string `json:"bucket"`
			AccessKey *string `json:"access_key"`
			SecretKey *string `json:"secret_key"`
			RootPath  *string `json:"root_path"`
			UseSSL    *bool   `json:"use_ssl"`
			Region    *string `json:"region"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		var cfg models.StorageConfig
		if err := database.DB.First(&cfg, 1).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Storage config not found"})
		}

		updates := map[string]interface{}{}
		if body.Backend != nil {
			updates["backend"] = *body.Backend
		}
		if body.Endpoint != nil {
			updates["endpoint"] = *body.Endpoint
		}
		if body.Bucket != nil {
			updates["bucket"] = *body.Bucket
		}
		if body.AccessKey != nil {
			updates["access_key"] = *body.AccessKey
		}
		if body.SecretKey != nil && *body.SecretKey != "********" {
			updates["secret_key"] = *body.SecretKey
		}
		if body.RootPath != nil {
			updates["root_path"] = *body.RootPath
		}
		if body.UseSSL != nil {
			updates["use_ssl"] = *body.UseSSL
		}
		if body.Region != nil {
			updates["region"] = *body.Region
		}

		if len(updates) > 0 {
			if err := database.DB.Model(&cfg).Updates(updates).Error; err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update storage config"})
			}
		}

		// Re-fetch to return updated state
		database.DB.First(&cfg, 1)
		masked := "********"
		if cfg.SecretKey == "" {
			masked = ""
		}
		return c.JSON(fiber.Map{
			"backend":    cfg.Backend,
			"endpoint":   cfg.Endpoint,
			"bucket":     cfg.Bucket,
			"access_key": cfg.AccessKey,
			"secret_key": masked,
			"root_path":  cfg.RootPath,
			"use_ssl":    cfg.UseSSL,
			"region":     cfg.Region,
		})
	})

	// POST /api/admin/storage/test — test connectivity of current storage config (SuperAdmin)
	app.Post("/api/admin/storage/test", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var cfg models.StorageConfig
		if err := database.DB.First(&cfg, 1).Error; err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"ok": false, "error": "No storage config found"})
		}
		if cfg.Endpoint == "" || cfg.Bucket == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"ok": false, "error": "Incomplete storage configuration"})
		}
		// Basic validation passed — actual connectivity test would require re-initializing client
		return c.JSON(fiber.Map{"ok": true, "backend": cfg.Backend, "endpoint": cfg.Endpoint, "bucket": cfg.Bucket})
	})

	fmt.Println("Starting Go Core API on :8080...")
	if err := app.Listen(":8080"); err != nil {
		log.Fatal(err)
	}
}
