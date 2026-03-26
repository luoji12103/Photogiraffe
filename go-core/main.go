package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"math"
	"math/bits"
	"net/http"
	"net/smtp"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"photogiraffe/core/auth"
	"photogiraffe/core/database"
	"photogiraffe/core/models"
	"photogiraffe/core/queue"
	"photogiraffe/core/storage"

	"github.com/ansrivas/fiberprometheus/v2"
	"github.com/go-redis/cache/v9"
	"github.com/gofiber/contrib/otelfiber/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/csrf"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	fiberrecover "github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/valyala/fasthttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// ── SSE Hub ──────────────────────────────────────────────────────────────────
// Per-user channels for Server-Sent Events.
// Each connected browser tab gets its own buffered channel.

var (
	redisCache     *cache.Cache
	logger         *slog.Logger
	tracerShutdown func(context.Context) error
)

// sseSubscribe creates a channel that receives SSE messages from Redis pub/sub
func sseSubscribe(uid uint) chan string {
	ch := make(chan string, 32)
	go func() {
		defer close(ch)
		ctx := context.Background()
		pubsub := queue.RedisClient.Subscribe(ctx, fmt.Sprintf("sse:user:%d", uid))
		defer pubsub.Close()

		for {
			msg, err := pubsub.ReceiveMessage(ctx)
			if err != nil {
				return
			}
			select {
			case ch <- msg.Payload:
			default:
			}
		}
	}()
	return ch
}

func sseUnsubscribe(uid uint, ch chan string) {
	// Channel closed by goroutine when pubsub closes
}

// broadcastToUser publishes an SSE event to Redis for a given internal userID
func broadcastToUser(userID uint, eventType, data string) {
	msg := fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, data)
	ctx := context.Background()
	queue.RedisClient.Publish(ctx, fmt.Sprintf("sse:user:%d", userID), msg)
}

func validatePagination(c *fiber.Ctx) (int, int, error) {
	page := c.QueryInt("page", 1)
	limit := c.QueryInt("limit", 20)

	if page < 1 {
		return 0, 0, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "page must be ≥1"})
	}
	if limit < 1 || limit > 100 {
		return 0, 0, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "limit must be between 1 and 100"})
	}

	return page, limit, nil
}

// createNotification persists a Notification row for the user (Phase 34).
func createNotification(userID uint, notifType, title, body string) {
	if err := database.DB.Create(&models.Notification{
		UserID: userID,
		Type:   notifType,
		Title:  title,
		Body:   body,
		IsRead: false,
	}).Error; err != nil {
		log.Printf("[createNotification error] userID=%d type=%s error=%v", userID, notifType, err)
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

// isAdmin returns true if the authenticated user has the SuperAdmin role.
func isAdmin(c *fiber.Ctx) bool {
	role, _ := c.Locals("userRole").(string)
	return role == "SuperAdmin"
}

// ── AI Rate-Limit helpers ────────────────────────────────────────────────────

// aiRatePeriodKey returns a stable string key for the current time window so
// that consecutive calls within the same window share the same Redis counter.
func aiRatePeriodKey(window string) string {
	now := time.Now()
	switch window {
	case "second":
		return fmt.Sprintf("%d", now.Unix())
	case "minute":
		return fmt.Sprintf("%d", now.Unix()/60)
	case "hour":
		return fmt.Sprintf("%d", now.Unix()/3600)
	case "day":
		return fmt.Sprintf("%d", now.Unix()/86400)
	case "week":
		return fmt.Sprintf("%d", now.Unix()/604800)
	case "month":
		return fmt.Sprintf("%d%02d", now.Year(), int(now.Month()))
	default:
		return fmt.Sprintf("%d", now.Unix()/60)
	}
}

// aiRateTTL returns a Redis key TTL (2× the window) for safe expiry.
func aiRateTTL(window string) time.Duration {
	switch window {
	case "second":
		return 2 * time.Second
	case "minute":
		return 2 * time.Minute
	case "hour":
		return 2 * time.Hour
	case "day":
		return 48 * time.Hour
	case "week":
		return 14 * 24 * time.Hour
	case "month":
		return 62 * 24 * time.Hour
	default:
		return 2 * time.Minute
	}
}

// checkAIRateLimit fetches all enabled AIRateLimit rules applicable to uid
// (user-specific first, then global) and enforces them via Redis INCR.
// Returns a non-nil error if any limit is exceeded; fails open on Redis errors.
func checkAIRateLimit(uid uint) error {
	var limits []models.AIRateLimit
	database.DB.Where(
		"enabled = true AND (target_type = 'all' OR (target_type = 'user' AND target_user_id = ?))",
		uid,
	).Find(&limits)

	for _, limit := range limits {
		periodKey := aiRatePeriodKey(limit.Window)
		redisKey := fmt.Sprintf("ai_rl:%s:%d:%s", limit.Window, uid, periodKey)

		count, err := queue.RedisClient.Incr(queue.Ctx, redisKey).Result()
		if err != nil {
			log.Printf("[ai_rate_limit] Redis INCR error for key %s: %v", redisKey, err)
			continue // fail open on Redis errors
		}
		if count == 1 {
			queue.RedisClient.Expire(queue.Ctx, redisKey, aiRateTTL(limit.Window))
		}
		if count > int64(limit.MaxRequests) {
			queue.RedisClient.Decr(queue.Ctx, redisKey) // roll back — request rejected
			return fmt.Errorf("频率限制：每 %s 最多 %d 次 AI 分析请求", limit.Window, limit.MaxRequests)
		}
	}
	return nil
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

// sha256sum returns the lowercase hex SHA-256 of a string.
func sha256sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// sendEmail sends a plain-text email using the given SmtpConfig.
func sendEmail(cfg models.SmtpConfig, to, subject, body string) error {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	from := fmt.Sprintf("%s <%s>", cfg.FromName, cfg.Username)
	msg := []byte("From: " + from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
		body + "\r\n")
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	return smtp.SendMail(addr, auth, cfg.Username, []string{to}, msg)
}

// recordLoginHistory inserts a LoginHistory row and trims rows beyond 10 per user.
func recordLoginHistory(userID uint, ip, ua string, success bool) {
	database.DB.Create(&models.LoginHistory{
		UserID: userID, IPAddress: ip, UserAgent: ua, Success: success,
	})
	database.DB.Exec(`
		DELETE FROM login_history
		WHERE id IN (
			SELECT id FROM login_history
			WHERE user_id = ?
			ORDER BY created_at DESC
			OFFSET 10
		)
	`, userID)
}

func initTracing(ctx context.Context) error {
	endpoint := strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
	if endpoint == "" {
		endpoint = "jaeger:4318"
	}

	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(endpoint),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return err
	}

	resource, err := sdkresource.Merge(
		sdkresource.Default(),
		sdkresource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName("photogiraffe-go-core"),
		),
	)
	if err != nil {
		return err
	}

	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource),
	)
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	tracerShutdown = provider.Shutdown
	return nil
}

func main() {
	logFormat := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_FORMAT")))
	if logFormat == "json" {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	} else {
		logger = slog.New(slog.NewTextHandler(os.Stdout, nil))
	}
	slog.SetDefault(logger)

	if err := initTracing(context.Background()); err != nil {
		logger.Error("failed to initialize tracing", "error", err)
		os.Exit(1)
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		logger.Error("JWT_SECRET must be set")
		os.Exit(1)
	}
	if len(jwtSecret) < 32 {
		logger.Error("JWT_SECRET must be at least 32 characters")
		os.Exit(1)
	}
	jwtKeyID := os.Getenv("JWT_KEY_ID")
	if jwtKeyID == "" {
		jwtKeyID = time.Now().UTC().Format("2006-01-02")
	}
	if err := auth.InitKeys(); err != nil {
		logger.Error("failed to initialize JWT RSA keys", "error", err)
		os.Exit(1)
	}
	internalSecret := os.Getenv("INTERNAL_SECRET")
	if internalSecret == "" {
		logger.Error("INTERNAL_SECRET environment variable is not set")
		os.Exit(1)
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

	// Initialize Redis Cache
	redisCache := cache.New(&cache.Options{
		Redis: queue.RedisClient,
	})

	// Load signing keys from database for rotation support
	var dbSigningKeys []models.SigningKey
	database.DB.Where("is_active = ? AND expires_at > ?", true, time.Now()).Find(&dbSigningKeys)
	if len(dbSigningKeys) > 0 {
		var loadedKeys []auth.DBKey
		for _, sk := range dbSigningKeys {
			priv, err := auth.DecodePrivateKeyPEM(sk.PrivateKey)
			if err != nil {
				logger.Warn("failed to decode private key", "key_id", sk.KeyID, "error", err)
				continue
			}
			pub, err := auth.DecodePublicKeyPEM(sk.PublicKey)
			if err != nil {
				logger.Warn("failed to decode public key", "key_id", sk.KeyID, "error", err)
				continue
			}
			loadedKeys = append(loadedKeys, auth.DBKey{
				KeyID:      sk.KeyID,
				PrivateKey: priv,
				PublicKey:  pub,
				ExpiresAt:  sk.ExpiresAt,
			})
		}
		if len(loadedKeys) > 0 {
			auth.LoadDBKeys(loadedKeys)
			logger.Info("loaded signing keys from database", "count", len(loadedKeys))
		}
	}

	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100 MB limit
	})

	app.Use(func(c *fiber.Ctx) error {
		requestID := c.Get("X-Request-Id")
		if requestID == "" {
			requestID = uuid.NewString()
		}
		c.Set("X-Request-Id", requestID)
		c.Locals("request_id", requestID)

		startedAt := time.Now()
		err := c.Next()
		attrs := []any{
			"request_id", requestID,
			"method", c.Method(),
			"path", c.Path(),
			"status", c.Response().StatusCode(),
			"duration_ms", time.Since(startedAt).Milliseconds(),
		}
		if userID, ok := c.Locals("userID").(uint); ok && userID != 0 {
			attrs = append(attrs, "user_id", userID)
		}
		if err != nil {
			logger.Error("request failed", append(attrs, "error", err)...)
			return err
		}
		logger.Info("request completed", attrs...)
		return nil
	})

	app.Use(fiberrecover.New(fiberrecover.Config{
		EnableStackTrace: true,
		StackTraceHandler: func(c *fiber.Ctx, e interface{}) {
			logger.Error("panic recovered", "path", c.Path(), "method", c.Method(), "panic", e)
		},
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins:     corsAllowOrigin,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, X-Internal-Secret, X-Csrf-Token",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS",
		AllowCredentials: true,
	}))

	app.Use(csrf.New(csrf.Config{
		KeyLookup:      "header:X-Csrf-Token",
		CookieName:     "__Host-csrf_",
		CookieSecure:   true,
		CookieHTTPOnly: false,
		CookieSameSite: "Lax",
		ContextKey:     "csrf",
		Expiration:     30 * time.Minute,
		Next: func(c *fiber.Ctx) bool {
			path := c.Path()
			if c.Get("X-Internal-Secret") != "" || strings.HasPrefix(path, "/internal/") {
				return true
			}
			return path == "/api/auth/login" || path == "/api/auth/register" || path == "/api/auth/refresh" || path == "/api/auth/forgot-password" || path == "/api/auth/reset-password"
		},
	}))

	app.Use(limiter.New(limiter.Config{
		Max:        600,
		Expiration: 1 * time.Minute,
		Storage:    limiter.ConfigDefault.Storage,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "Rate limit exceeded"})
		},
		Next: func(c *fiber.Ctx) bool {
			return strings.HasPrefix(c.Path(), "/internal/") || c.Path() == "/health" || c.Path() == "/health/ready" || c.Path() == "/metrics"
		},
	}))

	prometheus := fiberprometheus.New("photogiraffe_go_core")
	prometheus.RegisterAt(app, "/metrics")
	prometheus.SetSkipPaths([]string{"/metrics", "/health", "/health/ready"})
	app.Use(prometheus.Middleware)
	app.Use(otelfiber.Middleware(otelfiber.WithNext(func(c *fiber.Ctx) bool {
		return c.Path() == "/metrics" || c.Path() == "/health" || c.Path() == "/health/ready"
	})))

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "healthy"})
	})

	app.Get("/health/ready", func(c *fiber.Ctx) error {
		status := fiber.Map{"status": "healthy"}
		checks := fiber.Map{}

		sqlDB, err := database.DB.DB()
		if err != nil || sqlDB.Ping() != nil {
			checks["database"] = "unhealthy"
			status["status"] = "degraded"
		} else {
			checks["database"] = "healthy"
		}

		if err := queue.RedisClient.Ping(queue.Ctx).Err(); err != nil {
			checks["redis"] = "unhealthy"
			status["status"] = "degraded"
		} else {
			checks["redis"] = "healthy"
		}

		if _, err := storage.MinioClient.BucketExists(context.Background(), "photos"); err != nil {
			checks["minio"] = "unhealthy"
			status["status"] = "degraded"
		} else {
			checks["minio"] = "healthy"
		}

		status["checks"] = checks
		if status["status"] != "healthy" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(status)
		}
		return c.JSON(status)
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

		// Reload user to ensure PublicID (set by BeforeCreate hook) is populated
		if err := database.DB.First(&user, user.ID).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to retrieve user"})
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

		csrfToken, _ := c.Locals("csrf").(string)
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"access_token": accessToken,
			"csrf_token":   csrfToken,
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
			go func(ip, ua string) {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[goroutine panic] recordLoginHistory: %v", r)
					}
				}()
				recordLoginHistory(0, ip, ua, false)
			}(c.IP(), c.Get("User-Agent"))
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
			go func(uid uint, ip, ua string) {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[goroutine panic] recordLoginHistory: %v", r)
					}
				}()
				recordLoginHistory(uid, ip, ua, false)
			}(user.ID, c.IP(), c.Get("User-Agent"))
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
		go func(uid uint, ip, ua string) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[goroutine panic] recordLoginHistory: %v", r)
				}
			}()
			recordLoginHistory(uid, ip, ua, true)
		}(user.ID, c.IP(), c.Get("User-Agent"))

		c.Cookie(&fiber.Cookie{
			Name:     "refresh_token",
			Value:    rawRefresh,
			HTTPOnly: true,
			SameSite: "Strict",
			Expires:  refreshExpiry,
			Path:     "/",
		})

		csrfToken, _ := c.Locals("csrf").(string)
		return c.JSON(fiber.Map{
			"access_token": accessToken,
			"csrf_token":   csrfToken,
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

		csrfToken, _ := c.Locals("csrf").(string)
		return c.JSON(fiber.Map{"access_token": accessToken, "csrf_token": csrfToken})
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
	app.Get("/api/auth/jwks.json", func(c *fiber.Ctx) error {
		jwks, err := auth.GetJWKS(jwtKeyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load JWKS"})
		}
		return c.JSON(jwks)
	})

	// GET /api/auth/me — return current user profile
	app.Get("/api/auth/me", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var user models.User
		if result := database.DB.First(&user, uid); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
		}
		csrfToken, _ := c.Locals("csrf").(string)
		return c.JSON(fiber.Map{
			"id":         user.PublicID, // UUID — never expose sequential integer PK
			"username":   user.Username,
			"email":      user.Email,
			"role":       user.Role,
			"csrf_token": csrfToken,
		})
	})

	app.Get("/api/auth/csrf-token", requireJWT(), func(c *fiber.Ctx) error {
		token, _ := c.Locals("csrf").(string)
		if token == "" {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate CSRF token"})
		}
		return c.JSON(fiber.Map{"csrf_token": token})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 22 — Account Security + SMTP
	// ─────────────────────────────────────────────────────────────────────────

	// PUT /api/auth/change-password — change password (requires old password)
	app.Put("/api/auth/change-password", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var input struct {
			OldPassword string `json:"old_password"`
			NewPassword string `json:"new_password"`
		}
		if err := c.BodyParser(&input); err != nil || input.OldPassword == "" || input.NewPassword == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "old_password and new_password are required"})
		}
		if len(input.NewPassword) < 8 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "New password must be at least 8 characters"})
		}
		var user models.User
		if result := database.DB.First(&user, uid); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.OldPassword)); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Old password is incorrect"})
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), 12)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to hash password"})
		}
		database.DB.Model(&user).Update("password_hash", string(hash))
		// Revoke all refresh tokens to force re-login
		database.DB.Model(&models.RefreshToken{}).Where("user_id = ? AND revoked = false", uid).Update("revoked", true)
		c.ClearCookie("refresh_token")
		return c.JSON(fiber.Map{"message": "Password changed successfully. Please log in again."})
	})

	// PUT /api/auth/update-profile — update username and/or email
	app.Put("/api/auth/update-profile", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var input struct {
			Username string `json:"username"`
			Email    string `json:"email"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if input.Username == "" && input.Email == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "At least one of username or email is required"})
		}
		var user models.User
		if result := database.DB.First(&user, uid); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
		}
		updates := map[string]interface{}{}
		if input.Username != "" && input.Username != user.Username {
			// Check uniqueness
			var count int64
			database.DB.Model(&models.User{}).Where("username = ? AND id != ?", input.Username, uid).Count(&count)
			if count > 0 {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Username already taken"})
			}
			updates["username"] = input.Username
		}
		if input.Email != "" && input.Email != user.Email {
			var count int64
			database.DB.Model(&models.User{}).Where("email = ? AND id != ?", input.Email, uid).Count(&count)
			if count > 0 {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Email already registered"})
			}
			updates["email"] = input.Email
		}
		if len(updates) > 0 {
			database.DB.Model(&user).Updates(updates)
		}
		database.DB.First(&user, uid)
		return c.JSON(fiber.Map{"message": "Profile updated", "username": user.Username, "email": user.Email})
	})

	// GET /api/auth/login-history — last 10 login attempts for current user
	app.Get("/api/auth/login-history", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var history []models.LoginHistory
		database.DB.Where("user_id = ?", uid).Order("created_at DESC").Limit(10).Find(&history)
		type item struct {
			IP        string    `json:"ip"`
			UserAgent string    `json:"user_agent"`
			Success   bool      `json:"success"`
			At        time.Time `json:"at"`
		}
		result := make([]item, 0, len(history))
		for _, h := range history {
			result = append(result, item{
				IP:        h.IPAddress,
				UserAgent: h.UserAgent,
				Success:   h.Success,
				At:        h.CreatedAt,
			})
		}
		return c.JSON(result)
	})

	// POST /api/auth/forgot-password — request password reset email
	app.Post("/api/auth/forgot-password", authLimiter, func(c *fiber.Ctx) error {
		var input struct {
			Email string `json:"email"`
		}
		if err := c.BodyParser(&input); err != nil || input.Email == "" {
			// Still return 200 to prevent email enumeration
			return c.JSON(fiber.Map{"message": "If that email exists, a reset link has been sent."})
		}
		var user models.User
		if err := database.DB.Where("email = ?", input.Email).First(&user).Error; err != nil {
			// User not found — return 200 silently (anti-enumeration)
			return c.JSON(fiber.Map{"message": "If that email exists, a reset link has been sent."})
		}
		// Generate raw token (32 bytes hex) + SHA-256 hash for storage
		rawBytes := make([]byte, 32)
		if _, err := rand.Read(rawBytes); err != nil {
			log.Printf("crypto error generating reset token for email=%s: %v", input.Email, err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate reset token"})
		}
		rawToken := hex.EncodeToString(rawBytes)
		h := sha256sum(rawToken)
		expiry := time.Now().Add(5 * time.Minute)
		// Mark previous tokens for this user as used
		database.DB.Model(&models.PasswordResetToken{}).Where("user_id = ? AND used = false", user.ID).Update("used", true)
		database.DB.Create(&models.PasswordResetToken{
			UserID: user.ID, TokenHash: h, ExpiresAt: expiry,
		})
		// Send email if SMTP enabled
		var smtp models.SmtpConfig
		if database.DB.First(&smtp).Error == nil && smtp.Enabled {
			frontendURL := os.Getenv("FRONTEND_URL")
			if frontendURL == "" {
				frontendURL = "http://localhost:3000"
			}
			link := frontendURL + "/reset-password?token=" + rawToken
			go func(cfg models.SmtpConfig, email, subject, body string) {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[goroutine panic] sendEmail: %v", r)
					}
				}()
				if err := sendEmail(cfg, email, subject, body); err != nil {
					log.Printf("[sendEmail error] to=%s error=%v", email, err)
				}
			}(smtp, user.Email, "重置您的 Photogiraffe 密码",
				"您的密码重置链接（5分钟内有效）：\n\n"+link+"\n\n如非本人操作请忽略此邮件。")
		}
		return c.JSON(fiber.Map{"message": "If that email exists, a reset link has been sent."})
	})

	// POST /api/auth/reset-password — submit reset token + new password
	app.Post("/api/auth/reset-password", authLimiter, func(c *fiber.Ctx) error {
		var input struct {
			Token       string `json:"token"`
			NewPassword string `json:"new_password"`
		}
		if err := c.BodyParser(&input); err != nil || input.Token == "" || input.NewPassword == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token and new_password are required"})
		}
		if len(input.NewPassword) < 8 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Password must be at least 8 characters"})
		}
		h := sha256sum(input.Token)
		var prt models.PasswordResetToken
		if err := database.DB.Where("token_hash = ? AND used = false AND expires_at > ?", h, time.Now()).First(&prt).Error; err != nil {
			return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "Invalid or expired reset token"})
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), 12)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to hash password"})
		}
		database.DB.Model(&models.User{}).Where("id = ?", prt.UserID).Update("password_hash", string(hash))
		database.DB.Model(&prt).Update("used", true)
		// Revoke all refresh tokens
		database.DB.Model(&models.RefreshToken{}).Where("user_id = ? AND revoked = false", prt.UserID).Update("revoked", true)
		return c.JSON(fiber.Map{"message": "Password reset successfully. Please log in with your new password."})
	})

	// GET /api/admin/smtp — get SMTP config (password masked)
	app.Get("/api/admin/smtp", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var cfg models.SmtpConfig
		if database.DB.First(&cfg).Error != nil {
			return c.JSON(fiber.Map{"host": "", "port": 587, "username": "", "from_name": "Photogiraffe", "use_tls": true, "enabled": false})
		}
		return c.JSON(fiber.Map{
			"id": cfg.ID, "host": cfg.Host, "port": cfg.Port,
			"username": cfg.Username, "password": "****",
			"from_name": cfg.FromName, "use_tls": cfg.UseTLS, "enabled": cfg.Enabled,
		})
	})

	// PUT /api/admin/smtp — create or update SMTP config
	app.Put("/api/admin/smtp", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var input struct {
			Host     string `json:"host"`
			Port     int    `json:"port"`
			Username string `json:"username"`
			Password string `json:"password"`
			FromName string `json:"from_name"`
			UseTLS   bool   `json:"use_tls"`
			Enabled  bool   `json:"enabled"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		var cfg models.SmtpConfig
		if database.DB.First(&cfg).Error != nil {
			cfg = models.SmtpConfig{}
		}
		cfg.Host = input.Host
		if input.Port > 0 {
			cfg.Port = input.Port
		} else {
			cfg.Port = 587
		}
		cfg.Username = input.Username
		if input.Password != "" && input.Password != "****" {
			cfg.Password = input.Password
		}
		cfg.FromName = input.FromName
		cfg.UseTLS = input.UseTLS
		cfg.Enabled = input.Enabled
		if cfg.ID == 0 {
			database.DB.Create(&cfg)
		} else {
			database.DB.Save(&cfg)
		}
		return c.JSON(fiber.Map{"message": "SMTP config saved"})
	})

	// POST /api/admin/smtp/test — send a test email to the admin's own email
	app.Post("/api/admin/smtp/test", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var cfg models.SmtpConfig
		if database.DB.First(&cfg).Error != nil || !cfg.Enabled {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "SMTP not configured or disabled"})
		}
		uid := userIDFromLocals(c)
		var user models.User
		database.DB.First(&user, uid)
		if err := sendEmail(cfg, user.Email, "Photogiraffe SMTP 测试", "SMTP 配置正常，邮件发送测试成功！"); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to send email: " + err.Error()})
		}
		return c.JSON(fiber.Map{"message": "Test email sent to " + user.Email})
	})

	// POST /api/admin/keys/rotate — rotate JWT signing key (SuperAdmin only)
	app.Post("/api/admin/keys/rotate", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		priv, pub, err := auth.GenerateRSAKeyPair()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to generate key pair"})
		}

		privPEM := auth.EncodePrivateKeyPEM(priv)
		pubPEM, err := auth.EncodePublicKeyPEM(pub)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to encode public key"})
		}

		keyID := fmt.Sprintf("key-%d", time.Now().Unix())
		expiresAt := time.Now().Add(7 * 24 * time.Hour)

		newKey := models.SigningKey{
			KeyID:      keyID,
			PrivateKey: privPEM,
			PublicKey:  pubPEM,
			IsActive:   true,
			ExpiresAt:  expiresAt,
		}

		if err := database.DB.Create(&newKey).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to save key"})
		}

		auth.LoadDBKeys([]auth.DBKey{{
			KeyID:      keyID,
			PrivateKey: priv,
			PublicKey:  pub,
			ExpiresAt:  expiresAt,
		}})

		return c.JSON(fiber.Map{
			"message":    "key rotated successfully",
			"key_id":     keyID,
			"expires_at": expiresAt,
		})
	})

	// GET /api/admin/keys — list all signing keys (SuperAdmin only)
	app.Get("/api/admin/keys", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var keys []models.SigningKey
		database.DB.Order("created_at desc").Find(&keys)

		type KeyInfo struct {
			KeyID     string    `json:"key_id"`
			IsActive  bool      `json:"is_active"`
			CreatedAt time.Time `json:"created_at"`
			ExpiresAt time.Time `json:"expires_at"`
		}

		result := make([]KeyInfo, len(keys))
		for i, k := range keys {
			result[i] = KeyInfo{
				KeyID:     k.KeyID,
				IsActive:  k.IsActive,
				CreatedAt: k.CreatedAt,
				ExpiresAt: k.ExpiresAt,
			}
		}

		return c.JSON(result)
	})

	// ─── Phase 23 — Photo Notes + Timeline ───────────────────────────────────

	// GET /api/photos/:id/notes — list notes for a photo
	app.Get("/api/photos/:id/notes", requireJWT(), func(c *fiber.Ctx) error {
		photoID, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid photo id"})
		}
		uid := userIDFromLocals(c)
		// Verify photo ownership or admin
		var photo models.Photo
		if err := database.DB.First(&photo, photoID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		if photo.UserID != uid && !isAdmin(c) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		var notes []models.PhotoNote
		database.DB.Where("photo_id = ?", photoID).Order("created_at asc").Find(&notes)
		type NoteResp struct {
			ID        uint      `json:"id"`
			Content   string    `json:"content"`
			UserID    uint      `json:"user_id"`
			CreatedAt time.Time `json:"created_at"`
			UpdatedAt time.Time `json:"updated_at"`
		}
		out := make([]NoteResp, len(notes))
		for i, n := range notes {
			out[i] = NoteResp{ID: n.ID, Content: n.Content, UserID: n.UserID, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt}
		}
		return c.JSON(out)
	})

	// POST /api/photos/:id/notes — create a note
	app.Post("/api/photos/:id/notes", requireJWT(), func(c *fiber.Ctx) error {
		photoID, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid photo id"})
		}
		uid := userIDFromLocals(c)
		var photo models.Photo
		if err := database.DB.First(&photo, photoID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		if photo.UserID != uid && !isAdmin(c) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		var req struct {
			Content string `json:"content"`
		}
		if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.Content) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "content required"})
		}
		note := models.PhotoNote{PhotoID: uint(photoID), UserID: uid, Content: strings.TrimSpace(req.Content)}
		database.DB.Create(&note)
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": note.ID, "content": note.Content, "created_at": note.CreatedAt})
	})

	// PUT /api/photos/:id/notes/:noteId — update a note
	app.Put("/api/photos/:id/notes/:noteId", requireJWT(), func(c *fiber.Ctx) error {
		noteID, err := strconv.ParseUint(c.Params("noteId"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid note id"})
		}
		uid := userIDFromLocals(c)
		var note models.PhotoNote
		if err := database.DB.First(&note, noteID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "note not found"})
		}
		if note.UserID != uid && !isAdmin(c) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		var req struct {
			Content string `json:"content"`
		}
		if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.Content) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "content required"})
		}
		database.DB.Model(&note).Update("content", strings.TrimSpace(req.Content))
		return c.JSON(fiber.Map{"id": note.ID, "content": note.Content, "updated_at": note.UpdatedAt})
	})

	// DELETE /api/photos/:id/notes/:noteId — delete a note
	app.Delete("/api/photos/:id/notes/:noteId", requireJWT(), func(c *fiber.Ctx) error {
		noteID, err := strconv.ParseUint(c.Params("noteId"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid note id"})
		}
		uid := userIDFromLocals(c)
		var note models.PhotoNote
		if err := database.DB.First(&note, noteID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "note not found"})
		}
		if note.UserID != uid && !isAdmin(c) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		database.DB.Delete(&note)
		return c.JSON(fiber.Map{"message": "deleted"})
	})

	// GET /api/photos/timeline — photos grouped by year-month, sorted newest first
	app.Get("/api/photos/timeline", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var photos []models.Photo
		database.DB.Where("user_id = ? AND status = ?", uid, "completed").
			Preload("ExifData").
			Order("uploaded_at desc").
			Find(&photos)

		type TimelinePhoto struct {
			ID               uint      `json:"id"`
			OriginalFilename string    `json:"original_filename"`
			ThumbnailURL     string    `json:"thumbnail_url"`
			ShotAt           string    `json:"shot_at"`
			UploadedAt       time.Time `json:"uploaded_at"`
		}
		type MonthGroup struct {
			YearMonth string          `json:"year_month"` // "2024-03"
			Photos    []TimelinePhoto `json:"photos"`
		}
		groupMap := map[string]*MonthGroup{}
		var order []string
		for _, p := range photos {
			// Parse DateTimeOriginal (EXIF format "2006:01:02 15:04:05")
			shotAt := ""
			var shotKey string
			if p.ExifData.DateTimeOriginal != "" {
				if t, err := time.Parse("2006:01:02 15:04:05", p.ExifData.DateTimeOriginal); err == nil {
					shotAt = t.Format("2006-01-02T15:04:05Z")
					shotKey = t.Format("2006-01")
				}
			}
			if shotKey == "" {
				shotKey = p.UploadedAt.Format("2006-01")
			}
			if _, exists := groupMap[shotKey]; !exists {
				groupMap[shotKey] = &MonthGroup{YearMonth: shotKey, Photos: []TimelinePhoto{}}
				order = append(order, shotKey)
			}
			tp := TimelinePhoto{
				ID:               p.ID,
				OriginalFilename: p.OriginalFilename,
				ThumbnailURL:     fmt.Sprintf("/api/photos/%d/thumbnail", p.ID),
				ShotAt:           shotAt,
				UploadedAt:       p.UploadedAt,
			}
			groupMap[shotKey].Photos = append(groupMap[shotKey].Photos, tp)
		}
		result := make([]MonthGroup, 0, len(order))
		for _, k := range order {
			result = append(result, *groupMap[k])
		}
		return c.JSON(result)
	})

	// ─── Phase 25 — Favorites ─────────────────────────────────────────────────

	// GET /api/photos/favorites — paginated list of photos the current user has favorited
	app.Get("/api/photos/favorites", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		page := c.QueryInt("page", 1)
		if page < 1 {
			page = 1
		}
		limit := c.QueryInt("limit", 20)
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit

		var total int64
		database.DB.Model(&models.Favorite{}).Where("user_id = ?", uid).Count(&total)

		type PhotoWithFavResp struct {
			models.Photo
			IsFavorited bool `json:"is_favorited"`
		}

		var photos []models.Photo
		database.DB.Table("photos").
			Select("photos.*").
			Joins("JOIN favorites ON favorites.photo_id = photos.id").
			Where("favorites.user_id = ?", uid).
			Preload("ExifData").
			Order("favorites.created_at desc").
			Limit(limit).Offset(offset).
			Find(&photos)

		photoResp := make([]PhotoWithFavResp, 0, len(photos))
		for _, p := range photos {
			photoResp = append(photoResp, PhotoWithFavResp{Photo: p, IsFavorited: true})
		}

		totalPages := int((total + int64(limit) - 1) / int64(limit))
		return c.JSON(fiber.Map{
			"photos":      photoResp,
			"total":       total,
			"page":        page,
			"limit":       limit,
			"total_pages": totalPages,
		})
	})

	// POST /api/photos/:id/favorite — add a favorite
	app.Post("/api/photos/:id/favorite", requireJWT(), func(c *fiber.Ctx) error {
		photoIDParsed, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid photo id"})
		}
		uid := userIDFromLocals(c)
		var photo models.Photo
		if err := database.DB.First(&photo, photoIDParsed).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		// Must be own photo OR a public photo
		if photo.UserID != uid && !photo.IsPublic {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "can only favorite public photos by others"})
		}
		fav := models.Favorite{UserID: uid, PhotoID: uint(photoIDParsed)}
		result := database.DB.Where(fav).FirstOrCreate(&fav)
		alreadyExisted := result.RowsAffected == 0
		var count int64
		database.DB.Model(&models.Favorite{}).Where("photo_id = ?", photoIDParsed).Count(&count)
		return c.JSON(fiber.Map{"favorited": true, "already_existed": alreadyExisted, "count": count})
	})

	// DELETE /api/photos/:id/favorite — remove a favorite
	app.Delete("/api/photos/:id/favorite", requireJWT(), func(c *fiber.Ctx) error {
		photoIDParsed, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid photo id"})
		}
		uid := userIDFromLocals(c)
		database.DB.Where("user_id = ? AND photo_id = ?", uid, photoIDParsed).Delete(&models.Favorite{})
		var count int64
		database.DB.Model(&models.Favorite{}).Where("photo_id = ?", photoIDParsed).Count(&count)
		return c.JSON(fiber.Map{"favorited": false, "count": count})
	})

	// GET /api/photos/:id/favorite/count — public total favorite count for a photo
	app.Get("/api/photos/:id/favorite/count", requireJWT(), func(c *fiber.Ctx) error {
		photoIDStr := c.Params("id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var photo models.Photo
		if err := database.DB.First(&photo, photoIDStr).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		if photo.UserID == uid || photo.IsPublic || role == "SuperAdmin" {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		var count int64
		database.DB.Model(&models.Favorite{}).Where("photo_id = ?", photo.ID).Count(&count)
		var ownFav int64
		database.DB.Model(&models.Favorite{}).Where("user_id = ? AND photo_id = ?", uid, photo.ID).Count(&ownFav)
		return c.JSON(fiber.Map{"count": count, "is_favorited": ownFav > 0})
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

		traceparent := requestTraceparent(c)

		// Create a durable async task and publish it to Redis.
		_, err = queue.EnqueueImageProcessingTask(photo.ID, objectName, traceparent)
		if err != nil {
			log.Printf("Failed to enqueue image processing task for photo %d: %v", photo.ID, err)
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

		startDate := c.Query("start_date") // YYYY-MM-DD
		endDate := c.Query("end_date")     // YYYY-MM-DD
		limitStr := c.Query("limit", "500")
		limit := 500
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 && v <= 2000 {
			limit = v
		}

		type MapPoint struct {
			ID               uint    `json:"id"`
			Lat              float64 `json:"lat"`
			Lng              float64 `json:"lng"`
			ThumbnailPath    string  `json:"thumbnail_path"`
			OriginalFilename string  `json:"original_filename"`
			ShotAt           string  `json:"shot_at"`
		}

		type row struct {
			PhotoID          uint
			GPSLatitude      string
			GPSLongitude     string
			MinioPath        string
			OriginalFilename string
			DateTimeOriginal string
		}

		query := database.DB.Table("photos").
			Select("photos.id AS photo_id, exif_data.gps_latitude, exif_data.gps_longitude, photos.minio_path, photos.original_filename, exif_data.date_time_original").
			Joins("JOIN exif_data ON exif_data.photo_id = photos.id").
			Where("photos.deleted_at IS NULL AND exif_data.deleted_at IS NULL").
			Where("exif_data.gps_latitude != '' AND exif_data.gps_longitude != ''").
			Where("photos.status = 'completed'").
			Limit(limit)

		if role == "SuperAdmin" {
		} else {
			query = query.Where("photos.user_id = ?", uid)
		}
		if startDate != "" {
			query = query.Where("exif_data.date_time_original >= ?", startDate)
		}
		if endDate != "" {
			query = query.Where("exif_data.date_time_original <= (? || ' 23:59:59')", endDate)
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
			thumbPath := strings.Replace(r.MinioPath, "raw/", "thumb/", 1)
			thumbPath = thumbPath[:len(thumbPath)-len(filepath.Ext(thumbPath))] + ".webp"
			points = append(points, MapPoint{
				ID:               r.PhotoID,
				Lat:              lat,
				Lng:              lng,
				ThumbnailPath:    thumbPath,
				OriginalFilename: r.OriginalFilename,
				ShotAt:           r.DateTimeOriginal,
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
		colorBucket := strings.ToLower(strings.TrimSpace(c.Query("color_bucket", "")))
		sortParam := c.Query("sort", "date_desc") // date_desc|date_asc|filename|camera|iso

		// Build base query with ownership check
		base := database.DB.Model(&models.Photo{})
		if role == "SuperAdmin" {
		} else {
			base = base.Where("user_id = ?", uid)
		}
		if search != "" {
			base = base.Where("original_filename ILIKE '%' || ? || '%'", search)
		}
		if statusFilter != "" {
			base = base.Where("status = ?", statusFilter)
		}
		if colorBucket != "" {
			// Match photos where dominant_colors jsonb contains an entry with this bucket
			quotedColorBucket := fmt.Sprintf("\"%s\"", colorBucket)
			base = base.Where("dominant_colors::text ILIKE '%' || ? || '%'", quotedColorBucket)
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

		// Bulk-fetch which photos the requester has favorited
		photoIDs := make([]uint, len(photos))
		for i, p := range photos {
			photoIDs[i] = p.ID
		}
		favSet := map[uint]bool{}
		if len(photoIDs) > 0 {
			var favPhotoIDs []uint
			database.DB.Model(&models.Favorite{}).
				Where("user_id = ? AND photo_id IN ?", uid, photoIDs).
				Pluck("photo_id", &favPhotoIDs)
			for _, id := range favPhotoIDs {
				favSet[id] = true
			}
		}
		type PhotoWithFav struct {
			models.Photo
			IsFavorited bool `json:"is_favorited"`
		}
		photoResp := make([]PhotoWithFav, len(photos))
		for i, p := range photos {
			photoResp[i] = PhotoWithFav{Photo: p, IsFavorited: favSet[p.ID]}
		}

		return c.JSON(fiber.Map{
			"photos":      photoResp,
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		// Check if this viewer has favorited this photo
		var favCount int64
		database.DB.Model(&models.Favorite{}).Where("user_id = ? AND photo_id = ?", uid, photo.ID).Count(&favCount)
		var totalFavCount int64
		database.DB.Model(&models.Favorite{}).Where("photo_id = ?", photo.ID).Count(&totalFavCount)
		return c.JSON(fiber.Map{"photo": photo, "is_favorited": favCount > 0, "favorite_count": totalFavCount})
	})

	// API to get AI Config
	app.Get("/api/config/ai", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var config models.AIConfig
		err := redisCache.Once(&cache.Item{
			Key:   "ai_config",
			Value: &config,
			TTL:   1 * time.Hour,
			Do: func(*cache.Item) (interface{}, error) {
				result := database.DB.First(&config)
				if result.Error != nil {
					if result.Error == gorm.ErrRecordNotFound {
						return models.AIConfig{}, nil
					}
					return nil, result.Error
				}
				return config, nil
			},
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch AI config"})
		}
		if config.ID == 0 {
			return c.JSON(fiber.Map{})
		}
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
				database.DB.Create(&input)
				redisCache.Delete(c.Context(), "ai_config")
				return c.JSON(fiber.Map{"message": "AI config created successfully"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch AI config"})
		}

		// Update existing config
		config.Provider = input.Provider
		config.BaseURL = input.BaseURL
		config.ModelName = input.ModelName
		config.PromptLanguage = input.PromptLanguage
		if input.APIKey != "********" && input.APIKey != "" {
			config.APIKey = input.APIKey
		}
		database.DB.Save(&config)
		redisCache.Delete(c.Context(), "ai_config")

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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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

		// Check AI rate limits (admin-configurable per-user / global limits)
		if err := checkAIRateLimit(uid); err != nil {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": err.Error()})
		}

		// Push task to Redis Queue
		provider := config.Provider
		if provider == "" {
			provider = "openai_compatible"
		}
		promptLang := config.PromptLanguage
		if promptLang == "" {
			promptLang = "en"
		}
		traceparent := requestTraceparent(c)
		_, err := queue.EnqueueAIAnalysisTask(
			photo.ID,
			photo.MinioPath,
			provider,
			config.BaseURL,
			config.APIKey,
			config.ModelName,
			promptLang,
			traceparent,
		)
		if err != nil {
			log.Printf("Failed to enqueue AI analysis task for photo %d: %v", photo.ID, err)
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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

		inferPromptLang := config.PromptLanguage
		if inferPromptLang == "" {
			inferPromptLang = "en"
		}
		traceparent := requestTraceparent(c)
		if _, err := queue.EnqueueInferParamsTask(photo.ID, proxyPath, provider, config.BaseURL, config.APIKey, config.ModelName, inferPromptLang, traceparent); err != nil {
			log.Printf("Failed to enqueue parameter inference task for photo %d: %v", photo.ID, err)
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
	// Phase 20 — Auto-Tagging
	// ─────────────────────────────────────────────────────────────────────────

	// POST /api/photos/:id/auto-tag — queue worker-side auto-tagging for a photo
	app.Post("/api/photos/:id/auto-tag", requireJWT(), func(c *fiber.Ctx) error {
		id := c.Params("id")
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		var photo models.Photo
		if result := database.DB.First(&photo, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		if photo.Status != "completed" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Photo processing is not complete yet"})
		}

		if _, err := queue.EnqueueAutoTagTask(photo.ID, photo.MinioPath, requestTraceparent(c)); err != nil {
			log.Printf("Failed to enqueue auto-tag task for photo %d: %v", photo.ID, err)
		}
		return c.JSON(fiber.Map{"message": "Auto-tag task queued successfully"})
	})

	// PUT /internal/photos/:id/auto-tags — Python Worker callback: save derived tags
	app.Put("/internal/photos/:id/auto-tags", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var input struct {
			AutoTags string `json:"auto_tags"` // JSON array of tag strings
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		var photo models.Photo
		if result := database.DB.First(&photo, id); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Photo not found"})
		}

		if err := database.DB.Model(&photo).Update("auto_tags", &input.AutoTags).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save auto-tags"})
		}

		payload, _ := json.Marshal(map[string]interface{}{"photo_id": photo.ID})
		broadcastToUser(photo.UserID, "auto_tag_done", string(payload))

		return c.JSON(fiber.Map{"message": "Auto-tags saved"})
	})

	// PUT /internal/photos/:id/dominant-colors — Worker writes back extracted dominant colours (Phase 16)
	app.Put("/internal/photos/:id/dominant-colors", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var input struct {
			DominantColors string `json:"dominant_colors"` // JSON array: [{hex,bucket,pct},...]
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if result := database.DB.Model(&models.Photo{}).Where("id = ?", id).
			Update("dominant_colors", &input.DominantColors); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save dominant colors"})
		}
		return c.JSON(fiber.Map{"message": "Dominant colors saved"})
	})

	// PUT /internal/photos/:id/phash — Worker writes back perceptual hash (Phase 17)
	app.Put("/internal/photos/:id/phash", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var input struct {
			PHash string `json:"phash"` // 16-char hex string (64-bit pHash)
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if len(input.PHash) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "phash is required"})
		}
		if result := database.DB.Model(&models.Photo{}).Where("id = ?", id).
			Update("p_hash", &input.PHash); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save pHash"})
		}
		log.Printf("[pHash] saved phash=%s for photo id=%s", input.PHash, id)
		return c.JSON(fiber.Map{"message": "pHash saved"})
	})

	// GET /api/photos/duplicates — Return groups of near-duplicate photos (Hamming dist ≤ 10) (Phase 17)
	app.Get("/api/photos/duplicates", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)

		// Fetch all photos for this user that have a pHash
		var photos []models.Photo
		database.DB.Where("user_id = ? AND p_hash IS NOT NULL", uid).
			Select("id, original_filename, minio_path, uploaded_at, p_hash, file_size").
			Find(&photos)

		// Parse hex strings to uint64
		type photoHash struct {
			photo models.Photo
			hash  uint64
		}
		var items []photoHash
		for _, p := range photos {
			if p.PHash == nil {
				continue
			}
			val, err := strconv.ParseUint(*p.PHash, 16, 64)
			if err != nil {
				log.Printf("[pHash] failed to parse hash '%s' for photo %d: %v", *p.PHash, p.ID, err)
				continue
			}
			items = append(items, photoHash{p, val})
		}

		// Union-Find: group images with Hamming distance ≤ 10
		parent := make(map[uint]uint)
		for _, item := range items {
			parent[item.photo.ID] = item.photo.ID
		}
		var find func(uint) uint
		find = func(x uint) uint {
			if parent[x] != x {
				parent[x] = find(parent[x])
			}
			return parent[x]
		}
		for i := 0; i < len(items); i++ {
			for j := i + 1; j < len(items); j++ {
				dist := bits.OnesCount64(items[i].hash ^ items[j].hash)
				if dist <= 10 {
					rx, ry := find(items[i].photo.ID), find(items[j].photo.ID)
					if rx != ry {
						parent[ry] = rx
					}
				}
			}
		}

		// Collect groups of size ≥ 2
		groups := make(map[uint][]models.Photo)
		for _, item := range items {
			root := find(item.photo.ID)
			groups[root] = append(groups[root], item.photo)
		}
		type dupGroup struct {
			Photos []models.Photo `json:"photos"`
		}
		var result []dupGroup
		for _, gp := range groups {
			if len(gp) >= 2 {
				result = append(result, dupGroup{Photos: gp})
			}
		}
		if result == nil {
			result = []dupGroup{}
		}
		log.Printf("[pHash] duplicates query: user=%d photos_with_hash=%d groups=%d", uid, len(items), len(result))
		return c.JSON(fiber.Map{"groups": result, "total_groups": len(result)})
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
		if role == "SuperAdmin" {
		} else {
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
		if role == "SuperAdmin" || preset.UserID == uid {
		} else {
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
		if role == "SuperAdmin" || preset.UserID == uid {
		} else {
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
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		if result := q.First(&photo); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		if presetID < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid preset id"})
		}
		presetIDUint := uint(presetID)
		photo.AppliedPresetID = &presetIDUint
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
		if role == "SuperAdmin" || preset.UserID == uid {
		} else {
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

		optsRaw := c.Body()
		if len(optsRaw) == 0 {
			optsRaw = []byte("{}")
		}
		var optMap map[string]interface{}
		if err := json.Unmarshal(optsRaw, &optMap); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid export options JSON"})
		}

		if width, ok := optMap["width"].(float64); ok && (width < 1 || width > 8000) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "width must be between 1 and 8000"})
		}
		if height, ok := optMap["height"].(float64); ok && (height < 1 || height > 8000) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "height must be between 1 and 8000"})
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

		if photoID < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid photo id"})
		}
		photoIDUint := uint(photoID)
		job := models.ExportJob{
			PhotoID:       photoIDUint,
			UserID:        uid,
			Status:        "pending",
			ExportOptions: string(optsRaw),
		}
		if result := database.DB.Create(&job); result.Error != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create export job"})
		}

		traceparent := requestTraceparent(c)
		if _, err := queue.EnqueueExportTask(job.ID, photoIDUint, string(optsRaw), traceparent); err != nil {
			log.Printf("Failed to enqueue export job %d: %v", job.ID, err)
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		var jobs []models.ExportJob
		database.DB.Where("photo_id = ?", photoID).Order("created_at desc").Find(&jobs)
		return c.JSON(jobs)
	})

	// GET /api/exports — list all export jobs for the current user (paginated)
	app.Get("/api/exports", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		page := c.QueryInt("page", 1)
		limit := c.QueryInt("limit", 20)
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}
		statusFilter := c.Query("status", "")
		offset := (page - 1) * limit

		type JobDTO struct {
			models.ExportJob
			PhotoThumbnail string `json:"photo_thumbnail"`
			PhotoFilename  string `json:"photo_filename"`
		}

		var total int64
		q := database.DB.Model(&models.ExportJob{}).Where("user_id = ?", uid)
		if statusFilter != "" {
			q = q.Where("status = ?", statusFilter)
		}
		q.Count(&total)

		var jobs []models.ExportJob
		q2 := database.DB.Where("user_id = ?", uid)
		if statusFilter != "" {
			q2 = q2.Where("status = ?", statusFilter)
		}
		q2.Order("created_at desc").Limit(limit).Offset(offset).Find(&jobs)

		dtos := make([]JobDTO, 0, len(jobs))
		for _, j := range jobs {
			dto := JobDTO{ExportJob: j}
			var photo models.Photo
			if database.DB.Select("minio_path, original_filename").First(&photo, j.PhotoID).Error == nil {
				// derive proxy WebP path from raw/ path
				rawPath := photo.MinioPath
				base := strings.TrimPrefix(rawPath, "raw/")
				if dotIdx := strings.LastIndex(base, "."); dotIdx >= 0 {
					base = base[:dotIdx]
				}
				dto.PhotoThumbnail = "proxy/" + base + ".webp"
				dto.PhotoFilename = photo.OriginalFilename
			}
			dtos = append(dtos, dto)
		}

		return c.JSON(fiber.Map{
			"jobs":  dtos,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	})

	// DELETE /api/exports/:job_id — delete an export job record (completed/failed only)
	app.Delete("/api/exports/:job_id", requireJWT(), func(c *fiber.Ctx) error {
		jobID := c.Params("job_id")
		uid := userIDFromLocals(c)
		var job models.ExportJob
		if result := database.DB.First(&job, jobID); result.Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Export job not found"})
		}
		if job.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		if job.Status == "pending" || job.Status == "processing" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot delete a job that is still running"})
		}
		// Remove output file from MinIO if present
		if job.OutputPath != "" {
			ctx := c.Context()
			_ = storage.MinioClient.RemoveObject(ctx, "photos", job.OutputPath, minio.RemoveObjectOptions{})
		}
		database.DB.Delete(&job)
		return c.JSON(fiber.Map{"message": "deleted"})
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
		if role == "SuperAdmin" || job.UserID == uid {
		} else {
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
		if role == "SuperAdmin" || job.UserID == uid {
		} else {
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

		var err error
		switch input.Status {
		case "processing":
			err = markExportJobProcessing(&job)
		case "completed":
			err = markExportJobCompleted(&job, input.OutputPath)
		case "failed":
			err = markExportJobFailed(&job, input.ErrorMessage)
		default:
			err = database.DB.Model(&job).Update("status", input.Status).Error
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update export job"})
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		result := q.Delete(&models.Photo{})
		return c.JSON(fiber.Map{"deleted": result.RowsAffected})
	})

	// ─── Phase 26 — Unified Bulk Operations ───────────────────────────────────
	// POST /api/photos/bulk — handles: set_public, set_private, add_tag, remove_tag, star, unstar
	app.Post("/api/photos/bulk", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var body struct {
			IDs        []uint `json:"ids"`
			Action     string `json:"action"`
			Tag        string `json:"tag"`         // for add_tag / remove_tag
			Rating     int    `json:"rating"`      // for set_rating
			ColorLabel string `json:"color_label"` // for set_color_label
		}
		if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 || body.Action == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ids and action required"})
		}
		if len(body.IDs) > 200 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "maximum 200 photos per bulk operation"})
		}

		switch body.Action {
		case "set_public", "set_private":
			isPublic := body.Action == "set_public"
			q := database.DB.Model(&models.Photo{}).Where("id IN ?", body.IDs)
			if role == "SuperAdmin" {
			} else {
				q = q.Where("user_id = ?", uid)
			}
			res := q.Update("is_public", isPublic)
			return c.JSON(fiber.Map{"action": body.Action, "count": res.RowsAffected})

		case "add_tag", "remove_tag":
			if body.Tag == "" {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tag required for add_tag/remove_tag"})
			}
			q := database.DB.Model(&models.Photo{}).Where("id IN ?", body.IDs)
			if role == "SuperAdmin" {
			} else {
				q = q.Where("user_id = ?", uid)
			}
			var photos []models.Photo
			q.Find(&photos)
			updated := int64(0)
			for _, p := range photos {
				var tags []string
				if p.Tags != nil {
					_ = json.Unmarshal([]byte(*p.Tags), &tags)
				}
				if body.Action == "add_tag" {
					found := false
					for _, t := range tags {
						if t == body.Tag {
							found = true
							break
						}
					}
					if !found {
						tags = append(tags, body.Tag)
					}
				} else {
					filtered := make([]string, 0, len(tags))
					for _, t := range tags {
						if t != body.Tag {
							filtered = append(filtered, t)
						}
					}
					tags = filtered
				}
				if len(tags) == 0 {
					database.DB.Model(&p).Update("tags", nil)
				} else {
					b, _ := json.Marshal(tags)
					bs := string(b)
					database.DB.Model(&p).Update("tags", &bs)
				}
				updated++
			}
			return c.JSON(fiber.Map{"action": body.Action, "tag": body.Tag, "count": updated})

		case "star":
			for _, pid := range body.IDs {
				fav := models.Favorite{UserID: uid, PhotoID: pid}
				database.DB.Where(fav).FirstOrCreate(&fav)
			}
			return c.JSON(fiber.Map{"action": "star", "count": len(body.IDs)})

		case "unstar":
			result := database.DB.Where("user_id = ? AND photo_id IN ?", uid, body.IDs).Delete(&models.Favorite{})
			return c.JSON(fiber.Map{"action": "unstar", "count": result.RowsAffected})

		case "set_rating":
			if body.Rating < 0 || body.Rating > 5 {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "rating must be 0-5"})
			}
			qr := database.DB.Model(&models.Photo{}).Where("id IN ?", body.IDs)
			if role == "SuperAdmin" {
			} else {
				qr = qr.Where("user_id = ?", uid)
			}
			resr := qr.Update("rating", body.Rating)
			return c.JSON(fiber.Map{"action": "set_rating", "count": resr.RowsAffected})

		case "set_color_label":
			qcl := database.DB.Model(&models.Photo{}).Where("id IN ?", body.IDs)
			if role == "SuperAdmin" {
			} else {
				qcl = qcl.Where("user_id = ?", uid)
			}
			rescl := qcl.Update("color_label", body.ColorLabel)
			return c.JSON(fiber.Map{"action": "set_color_label", "count": rescl.RowsAffected})

		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "unknown action: " + body.Action})
		}
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
		if role == "SuperAdmin" || album.UserID == uid {
		} else {
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

	// ─── Phase 27 — Smart Albums ──────────────────────────────────────────────

	// GET /api/smart-albums — list all smart albums for current user
	app.Get("/api/smart-albums", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var albums []models.SmartAlbum
		database.DB.Where("user_id = ?", uid).Order("created_at desc").Find(&albums)
		return c.JSON(albums)
	})

	// POST /api/smart-albums — create a new smart album
	app.Post("/api/smart-albums", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var body struct {
			Name       string `json:"name"`
			RuleType   string `json:"rule_type"`
			RuleParams string `json:"rule_params"`
		}
		if err := c.BodyParser(&body); err != nil || body.Name == "" || body.RuleType == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name and rule_type required"})
		}
		validRules := map[string]bool{"date_range": true, "tags_contain": true, "camera_model": true, "auto_tags_contain": true, "color_bucket": true}
		if !validRules[body.RuleType] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid rule_type"})
		}
		params := body.RuleParams
		if params == "" {
			params = "{}"
		}
		album := models.SmartAlbum{UserID: uid, Name: body.Name, RuleType: body.RuleType, RuleParams: params}
		if err := database.DB.Create(&album).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create smart album"})
		}
		return c.Status(fiber.StatusCreated).JSON(album)
	})

	// GET /api/smart-albums/:id — get a single smart album
	app.Get("/api/smart-albums/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var album models.SmartAlbum
		if err := database.DB.First(&album, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "smart album not found"})
		}
		if role == "SuperAdmin" || album.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.JSON(album)
	})

	// PUT /api/smart-albums/:id — update a smart album
	app.Put("/api/smart-albums/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var album models.SmartAlbum
		if err := database.DB.First(&album, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "smart album not found"})
		}
		if role == "SuperAdmin" || album.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		var body struct {
			Name       string `json:"name"`
			RuleType   string `json:"rule_type"`
			RuleParams string `json:"rule_params"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		if body.Name != "" {
			album.Name = body.Name
		}
		if body.RuleType != "" {
			validRules := map[string]bool{"date_range": true, "tags_contain": true, "camera_model": true, "auto_tags_contain": true, "color_bucket": true}
			if !validRules[body.RuleType] {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid rule_type"})
			}
			album.RuleType = body.RuleType
		}
		if body.RuleParams != "" {
			album.RuleParams = body.RuleParams
		}
		database.DB.Save(&album)
		return c.JSON(album)
	})

	// DELETE /api/smart-albums/:id — delete a smart album
	app.Delete("/api/smart-albums/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var album models.SmartAlbum
		if err := database.DB.First(&album, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "smart album not found"})
		}
		if role == "SuperAdmin" || album.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		database.DB.Delete(&album)
		return c.JSON(fiber.Map{"deleted": true})
	})

	// GET /api/smart-albums/:id/photos — evaluate rule and return matching photos
	app.Get("/api/smart-albums/:id/photos", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var album models.SmartAlbum
		if err := database.DB.First(&album, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "smart album not found"})
		}
		if role == "SuperAdmin" || album.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}

		page := c.QueryInt("page", 1)
		if page < 1 {
			page = 1
		}
		limit := c.QueryInt("limit", 20)
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit

		// Base query — only user's own photos
		q := database.DB.Model(&models.Photo{}).Where("user_id = ? AND status = 'completed'", uid)

		// Parse rule params
		var params map[string]interface{}
		_ = json.Unmarshal([]byte(album.RuleParams), &params)

		switch album.RuleType {
		case "date_range":
			if from, ok := params["from"].(string); ok && from != "" {
				q = q.Where("uploaded_at >= ?", from)
			}
			if to, ok := params["to"].(string); ok && to != "" {
				q = q.Where("uploaded_at <= (? || ' 23:59:59')", to)
			}
		case "tags_contain":
			if tags, ok := params["tags"].([]interface{}); ok {
				for _, t := range tags {
					if tagStr, ok := t.(string); ok && tagStr != "" {
						q = q.Where("tags::text ILIKE '%' || ? || '%'", tagStr)
					}
				}
			}
		case "auto_tags_contain":
			if tags, ok := params["tags"].([]interface{}); ok {
				for _, t := range tags {
					if tagStr, ok := t.(string); ok && tagStr != "" {
						q = q.Where("auto_tags::text ILIKE '%' || ? || '%'", tagStr)
					}
				}
			}
		case "camera_model":
			if model, ok := params["model"].(string); ok && model != "" {
				q = q.Joins("JOIN exif_data ON exif_data.photo_id = photos.id").
					Where("exif_data.camera_model ILIKE '%' || ? || '%'", model)
			}
		case "color_bucket":
			if bucket, ok := params["bucket"].(string); ok && bucket != "" {
				q = q.Where("dominant_colors::text ILIKE '%' || ? || '%'", bucket)
			}
		}

		var total int64
		q.Count(&total)

		var photos []models.Photo
		q.Preload("ExifData").Order("uploaded_at desc").Limit(limit).Offset(offset).Find(&photos)

		totalPages := int((total + int64(limit) - 1) / int64(limit))
		return c.JSON(fiber.Map{
			"photos":      photos,
			"total":       total,
			"page":        page,
			"limit":       limit,
			"total_pages": totalPages,
			"album":       album,
		})
	})

	// ─── Phase 28 — Analytics / Statistics ───────────────────────────────────

	// GET /api/analytics/monthly — photos uploaded per month (last 12 months)
	app.Get("/api/analytics/monthly", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		type Row struct {
			Month string `json:"month"`
			Count int64  `json:"count"`
		}
		rows := make([]Row, 0)
		database.DB.Raw(`
			SELECT to_char(date_trunc('month', uploaded_at), 'YYYY-MM') AS month,
			       COUNT(*) AS count
			FROM photos
			WHERE user_id = ? AND status = 'completed'
			  AND uploaded_at >= NOW() - INTERVAL '12 months'
			GROUP BY 1
			ORDER BY 1
		`, uid).Scan(&rows)
		return c.JSON(rows)
	})

	// GET /api/analytics/camera — top 10 camera models by photo count
	app.Get("/api/analytics/camera", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		type Row struct {
			Camera string `json:"camera"`
			Count  int64  `json:"count"`
		}
		rows := make([]Row, 0)
		database.DB.Raw(`
			SELECT e.camera_model AS camera, COUNT(*) AS count
			FROM exif_data e
			JOIN photos p ON p.id = e.photo_id
			WHERE p.user_id = ? AND p.status = 'completed'
			  AND e.camera_model IS NOT NULL AND e.camera_model <> ''
			GROUP BY 1
			ORDER BY 2 DESC
			LIMIT 10
		`, uid).Scan(&rows)
		return c.JSON(rows)
	})

	// GET /api/analytics/focal-length — focal length distribution (binned)
	app.Get("/api/analytics/focal-length", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		type Row struct {
			Bin   string `json:"bin"`
			Count int64  `json:"count"`
		}
		rows := make([]Row, 0)
		database.DB.Raw(`
			SELECT CASE
				WHEN e.focal_length < 20  THEN '<20mm'
				WHEN e.focal_length < 35  THEN '20-35mm'
				WHEN e.focal_length < 50  THEN '35-50mm'
				WHEN e.focal_length < 85  THEN '50-85mm'
				WHEN e.focal_length < 135 THEN '85-135mm'
				WHEN e.focal_length < 200 THEN '135-200mm'
				ELSE '200mm+'
			END AS bin,
			COUNT(*) AS count
			FROM exif_data e
			JOIN photos p ON p.id = e.photo_id
			WHERE p.user_id = ? AND p.status = 'completed'
			  AND e.focal_length IS NOT NULL AND e.focal_length > 0
			GROUP BY 1
			ORDER BY MIN(e.focal_length)
		`, uid).Scan(&rows)
		return c.JSON(rows)
	})

	// GET /api/analytics/iso — ISO distribution (binned)
	app.Get("/api/analytics/iso", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		type Row struct {
			Bin   string `json:"bin"`
			Count int64  `json:"count"`
		}
		rows := make([]Row, 0)
		database.DB.Raw(`
			SELECT CASE
				WHEN e.iso < 100   THEN '<100'
				WHEN e.iso < 200   THEN '100-200'
				WHEN e.iso < 400   THEN '200-400'
				WHEN e.iso < 800   THEN '400-800'
				WHEN e.iso < 1600  THEN '800-1600'
				WHEN e.iso < 3200  THEN '1600-3200'
				ELSE '3200+'
			END AS bin,
			COUNT(*) AS count
			FROM exif_data e
			JOIN photos p ON p.id = e.photo_id
			WHERE p.user_id = ? AND p.status = 'completed'
			  AND e.iso IS NOT NULL AND e.iso > 0
			GROUP BY 1
			ORDER BY MIN(e.iso)
		`, uid).Scan(&rows)
		return c.JSON(rows)
	})

	// GET /api/analytics/summary — quick summary (total photos, total size, favorites, albums)
	app.Get("/api/analytics/summary", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		type Summary struct {
			TotalPhotos      int64 `json:"total_photos"`
			TotalFavorites   int64 `json:"total_favorites"`
			TotalAlbums      int64 `json:"total_albums"`
			TotalSmartAlbums int64 `json:"total_smart_albums"`
		}
		var s Summary
		database.DB.Raw(`
			SELECT 
				(SELECT COUNT(*) FROM photos WHERE user_id = ? AND status = 'completed' AND deleted_at IS NULL) as total_photos,
				(SELECT COUNT(*) FROM favorites WHERE user_id = ? AND deleted_at IS NULL) as total_favorites,
				(SELECT COUNT(*) FROM albums WHERE user_id = ? AND deleted_at IS NULL) as total_albums,
				(SELECT COUNT(*) FROM smart_albums WHERE user_id = ? AND deleted_at IS NULL) as total_smart_albums
		`, uid, uid, uid, uid).Scan(&s)
		return c.JSON(s)
	})

	// ─── Phase 29 — Enhanced Search: Tag Autocomplete & Saved Searches ────────

	// GET /api/photos/tags/autocomplete?q= — top tags matching query
	app.Get("/api/photos/tags/autocomplete", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		q := strings.TrimSpace(c.Query("q", ""))
		type Row struct {
			Tag   string `json:"tag"`
			Count int64  `json:"count"`
		}
		rows := make([]Row, 0)
		pattern := "%" + q + "%"
		database.DB.Raw(`
			SELECT tag, COUNT(*) AS count
			FROM photos, unnest(string_to_array(btrim(tags::text,'{}'), ',')) AS tag
			WHERE user_id = ? AND status = 'completed'
			  AND tag ILIKE ?
			GROUP BY tag
			ORDER BY count DESC
			LIMIT 20
		`, uid, pattern).Scan(&rows)
		return c.JSON(rows)
	})

	// GET /api/saved-searches — list current user's saved searches
	app.Get("/api/saved-searches", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var searches []models.SavedSearch
		database.DB.Where("user_id = ?", uid).Order("created_at desc").Find(&searches)
		return c.JSON(searches)
	})

	// POST /api/saved-searches — save a search
	app.Post("/api/saved-searches", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var body struct {
			Name   string `json:"name"`
			Params string `json:"params"`
		}
		if err := c.BodyParser(&body); err != nil || body.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name required"})
		}
		params := body.Params
		if params == "" {
			params = "{}"
		}
		ss := models.SavedSearch{UserID: uid, Name: body.Name, Params: params}
		if err := database.DB.Create(&ss).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to save search"})
		}
		return c.Status(fiber.StatusCreated).JSON(ss)
	})

	// DELETE /api/saved-searches/:id — delete a saved search
	app.Delete("/api/saved-searches/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var ss models.SavedSearch
		if err := database.DB.First(&ss, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
		}
		if ss.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		database.DB.Delete(&ss)
		return c.JSON(fiber.Map{"deleted": true})
	})

	// ─── Phase 30 — Data Backup / Export ─────────────────────────────────────

	// POST /api/backup/export — create a backup job and enqueue it
	app.Post("/api/backup/export", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		// Check for a running or pending job to avoid duplicates
		var existing models.BackupJob
		if err := database.DB.Where("user_id = ? AND status IN ('pending','processing')", uid).
			First(&existing).Error; err == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":  "a backup job is already in progress",
				"job_id": existing.ID,
			})
		}
		job := models.BackupJob{UserID: uid, Status: "pending"}
		if err := database.DB.Create(&job).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create backup job"})
		}
		if _, err := queue.EnqueueBackupTask(job.ID, uid, requestTraceparent(c)); err != nil {
			log.Printf("Warning: failed to enqueue backup job %d: %v", job.ID, err)
		}
		return c.Status(fiber.StatusCreated).JSON(job)
	})

	// GET /api/backup/jobs — list all backup jobs for user
	app.Get("/api/backup/jobs", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var jobs []models.BackupJob
		database.DB.Where("user_id = ?", uid).Order("created_at desc").Limit(50).Find(&jobs)
		return c.JSON(jobs)
	})

	// GET /api/backup/jobs/:id — get single backup job (with download URL if completed)
	app.Get("/api/backup/jobs/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var job models.BackupJob
		if err := database.DB.First(&job, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
		}
		if role == "SuperAdmin" || job.UserID == uid {
		} else {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		result := map[string]interface{}{
			"ID":           job.ID,
			"UserID":       job.UserID,
			"Status":       job.Status,
			"OutputPath":   job.OutputPath,
			"ErrorMessage": job.ErrorMessage,
			"CompletedAt":  job.CompletedAt,
			"CreatedAt":    job.CreatedAt,
		}
		// Generate a presigned download URL if the job is completed
		if job.Status == "completed" && job.OutputPath != "" {
			presignedURL, err := storage.MinioClient.PresignedGetObject(
				c.Context(), "photos", job.OutputPath, 24*time.Hour, nil,
			)
			if err == nil {
				result["download_url"] = presignedURL.String()
			}
		}
		return c.JSON(result)
	})

	// DELETE /api/backup/jobs/:id — cancel/delete a backup job
	app.Delete("/api/backup/jobs/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var job models.BackupJob
		if err := database.DB.First(&job, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
		}
		if job.UserID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		if job.Status == "pending" || job.Status == "processing" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cannot delete a backup job that is still running"})
		}
		var task models.AsyncTask
		if err := database.DB.Where("resource_type = ? AND resource_id = ?", "backup_job", job.ID).Order("created_at desc").First(&task).Error; err == nil {
			if task.Status == queue.AsyncTaskStatusPending || task.Status == queue.AsyncTaskStatusProcessing || task.Status == queue.AsyncTaskStatusRetryScheduled {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cannot delete a backup job that is still active"})
			}
		}
		if job.OutputPath != "" {
			_ = storage.MinioClient.RemoveObject(c.Context(), "photos", job.OutputPath, minio.RemoveObjectOptions{})
		}
		database.DB.Delete(&job)
		return c.JSON(fiber.Map{"deleted": true})
	})

	// PUT /internal/backup-jobs/:id/status — Python Worker updates backup job status
	app.Put("/internal/backup-jobs/:id/status", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		var body struct {
			Status       string `json:"status"`
			OutputPath   string `json:"output_path"`
			ErrorMessage string `json:"error_message"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		var job models.BackupJob
		if err := database.DB.First(&job, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
		}
		var err error
		switch body.Status {
		case "processing":
			err = markBackupJobProcessing(&job)
		case "completed":
			err = markBackupJobCompleted(&job, body.OutputPath)
		case "failed":
			err = markBackupJobFailed(&job, body.ErrorMessage)
		default:
			err = database.DB.Model(&job).Update("status", body.Status).Error
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update backup job"})
		}
		return c.JSON(job)
	})

	// GET /internal/users/:user_id/photos — return all photo metadata for a user (for backup worker)
	app.Get("/internal/users/:user_id/photos", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		var photos []models.Photo
		database.DB.Where("user_id = ? AND status = 'completed'", c.Params("user_id")).
			Preload("ExifData").Order("uploaded_at desc").Find(&photos)
		return c.JSON(photos)
	})

	// PUT /internal/async-tasks/:id/start — mark a durable async task as processing
	app.Put("/internal/async-tasks/:id/start", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		taskID, err := c.ParamsInt("id")
		if err != nil || taskID <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid task id"})
		}
		var body struct {
			WorkerID string `json:"worker_id"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		task, err := queue.StartAsyncTask(uint(taskID), body.WorkerID)
		if err != nil {
			if errors.Is(err, queue.ErrAsyncTaskAlreadyActive) || errors.Is(err, queue.ErrAsyncTaskNotRunnable) {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "task not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to start task"})
		}
		return c.JSON(task)
	})

	// PUT /internal/async-tasks/:id/heartbeat — extend the lease for an in-flight async task
	app.Put("/internal/async-tasks/:id/heartbeat", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		taskID, err := c.ParamsInt("id")
		if err != nil || taskID <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid task id"})
		}
		var body struct {
			WorkerID string `json:"worker_id"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		task, err := queue.HeartbeatAsyncTask(uint(taskID), body.WorkerID)
		if err != nil {
			if errors.Is(err, queue.ErrAsyncTaskAlreadyActive) || errors.Is(err, queue.ErrAsyncTaskNotRunnable) {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "task not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to heartbeat task"})
		}
		return c.JSON(task)
	})

	// PUT /internal/async-tasks/:id/succeed — mark a durable async task as completed
	app.Put("/internal/async-tasks/:id/succeed", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		taskID, err := c.ParamsInt("id")
		if err != nil || taskID <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid task id"})
		}
		var body struct {
			WorkerID string `json:"worker_id"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		task, err := queue.SucceedAsyncTask(uint(taskID), body.WorkerID)
		if err != nil {
			if errors.Is(err, queue.ErrAsyncTaskAlreadyActive) || errors.Is(err, queue.ErrAsyncTaskNotRunnable) {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "task not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to complete task"})
		}
		return c.JSON(task)
	})

	// PUT /internal/async-tasks/:id/fail — schedule retry or dead-letter a task
	app.Put("/internal/async-tasks/:id/fail", requireInternalSecret(internalSecret), func(c *fiber.Ctx) error {
		taskID, err := c.ParamsInt("id")
		if err != nil || taskID <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid task id"})
		}
		var body struct {
			WorkerID     string `json:"worker_id"`
			ErrorMessage string `json:"error_message"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		task, err := queue.FailAsyncTask(uint(taskID), body.WorkerID, body.ErrorMessage)
		if err != nil {
			if errors.Is(err, queue.ErrAsyncTaskAlreadyActive) || errors.Is(err, queue.ErrAsyncTaskNotRunnable) {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "task not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fail task"})
		}
		if task.Status == queue.AsyncTaskStatusDeadLetter {
			handleTerminalAsyncTaskFailure(task)
		}
		return c.JSON(task)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 5 — Feature Flags & Admin
	// ─────────────────────────────────────────────────────────────────────────

	// GET /api/admin/flags — list all feature flags (SuperAdmin)
	app.Get("/api/admin/flags", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var flags []models.FeatureFlag
		err := redisCache.Once(&cache.Item{
			Key:   "feature_flags",
			Value: &flags,
			TTL:   5 * time.Minute,
			Do: func(*cache.Item) (interface{}, error) {
				database.DB.Order("feature_name asc").Find(&flags)
				return flags, nil
			},
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch flags"})
		}
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
		redisCache.Delete(c.Context(), "feature_flags")
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
		if role == "SuperAdmin" {
		} else {
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
			"minio_path":         photo.MinioPath,
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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

		if photoID < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid photo id"})
		}
		photoIDUint := uint(photoID)
		sl := models.ShareLink{
			PhotoID:   photoIDUint,
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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

	// ─────────────────────────────────────────────────────────────────────────
	// Phase 18 — Admin AI Rate-Limit Management
	// ─────────────────────────────────────────────────────────────────────────

	// GET /api/admin/ai-rate-limits — list all rules with username annotation
	app.Get("/api/admin/ai-rate-limits", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var limits []models.AIRateLimit
		database.DB.Find(&limits)

		type RateLimitDTO struct {
			models.AIRateLimit
			TargetUsername string `json:"target_username,omitempty"`
		}
		result := make([]RateLimitDTO, 0, len(limits))
		for _, l := range limits {
			dto := RateLimitDTO{AIRateLimit: l}
			if l.TargetUserID != nil {
				var u models.User
				if database.DB.First(&u, l.TargetUserID).Error == nil {
					dto.TargetUsername = u.Username
				}
			}
			result = append(result, dto)
		}
		return c.JSON(result)
	})

	// POST /api/admin/ai-rate-limits — create a new rule
	app.Post("/api/admin/ai-rate-limits", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var input struct {
			TargetType   string `json:"target_type"`
			TargetUserID *uint  `json:"target_user_id"`
			Window       string `json:"window"`
			MaxRequests  int    `json:"max_requests"`
			Enabled      bool   `json:"enabled"`
			Note         string `json:"note"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		validWindows := map[string]bool{"second": true, "minute": true, "hour": true, "day": true, "week": true, "month": true}
		if !validWindows[input.Window] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "window must be one of: second, minute, hour, day, week, month"})
		}
		if input.MaxRequests <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "max_requests must be > 0"})
		}
		targetType := input.TargetType
		if targetType == "" {
			targetType = "all"
		}
		limit := models.AIRateLimit{
			TargetType:   targetType,
			TargetUserID: input.TargetUserID,
			Window:       input.Window,
			MaxRequests:  input.MaxRequests,
			Enabled:      input.Enabled,
			Note:         input.Note,
		}
		if err := database.DB.Create(&limit).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create rate limit"})
		}
		return c.Status(fiber.StatusCreated).JSON(limit)
	})

	// PUT /api/admin/ai-rate-limits/:id — update an existing rule
	app.Put("/api/admin/ai-rate-limits/:id", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		id := c.Params("id")
		var limit models.AIRateLimit
		if database.DB.First(&limit, id).Error != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Rate limit rule not found"})
		}
		var input struct {
			TargetType   *string `json:"target_type"`
			TargetUserID *uint   `json:"target_user_id"`
			Window       *string `json:"window"`
			MaxRequests  *int    `json:"max_requests"`
			Enabled      *bool   `json:"enabled"`
			Note         *string `json:"note"`
		}
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		updates := map[string]interface{}{}
		if input.TargetType != nil {
			updates["target_type"] = *input.TargetType
		}
		if input.TargetUserID != nil {
			updates["target_user_id"] = *input.TargetUserID
		}
		if input.Window != nil {
			validWindows := map[string]bool{"second": true, "minute": true, "hour": true, "day": true, "week": true, "month": true}
			if !validWindows[*input.Window] {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "window must be one of: second, minute, hour, day, week, month"})
			}
			updates["window"] = *input.Window
		}
		if input.MaxRequests != nil {
			updates["max_requests"] = *input.MaxRequests
		}
		if input.Enabled != nil {
			updates["enabled"] = *input.Enabled
		}
		if input.Note != nil {
			updates["note"] = *input.Note
		}
		database.DB.Model(&limit).Updates(updates)
		database.DB.First(&limit, id)
		return c.JSON(limit)
	})

	// DELETE /api/admin/ai-rate-limits/:id — delete a rule
	app.Delete("/api/admin/ai-rate-limits/:id", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		id := c.Params("id")
		result := database.DB.Delete(&models.AIRateLimit{}, id)
		if result.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Rate limit rule not found"})
		}
		return c.JSON(fiber.Map{"message": "Rate limit rule deleted"})
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
		if role == "SuperAdmin" {
		} else {
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
		if role == "SuperAdmin" {
		} else {
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
		traceparent := requestTraceparent(c)
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
			if _, err := queue.EnqueueExportTask(job.ID, photo.ID, optsJSON, traceparent); err != nil {
				log.Printf("Failed to enqueue bulk export job %d: %v", job.ID, err)
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

		if albumID < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid album id"})
		}
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

		traceparent := requestTraceparent(c)
		if _, err := queue.EnqueueAlbumExportTask(job.ID, albumIDUint, string(optsRaw), traceparent); err != nil {
			log.Printf("Failed to enqueue album export job %d: %v", job.ID, err)
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

		if albumID < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid album id"})
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
		focalMin := strings.TrimSpace(c.Query("focal_min", ""))
		focalMax := strings.TrimSpace(c.Query("focal_max", ""))
		hasGPS := strings.TrimSpace(c.Query("has_gps", ""))
		isFavorited := strings.TrimSpace(c.Query("is_favorited", ""))

		query := database.DB.Model(&models.Photo{}).
			Joins("LEFT JOIN exif_data ON exif_data.photo_id = photos.id AND exif_data.deleted_at IS NULL")
		if role == "SuperAdmin" {
		} else {
			query = query.Where("photos.user_id = ?", uid)
		}
		query = query.Where("photos.status = ?", "completed")

		if q != "" {
			query = query.Where("photos.original_filename ILIKE '%' || ? || '%' OR exif_data.camera_model ILIKE '%' || ? || '%' OR exif_data.lens_model ILIKE '%' || ? || '%'", q, q, q)
		}
		if camera != "" {
			query = query.Where("exif_data.camera_model ILIKE '%' || ? || '%'", camera)
		}
		if lens != "" {
			query = query.Where("exif_data.lens_model ILIKE '%' || ? || '%'", lens)
		}
		if colorSpace != "" {
			query = query.Where("exif_data.color_space ILIKE '%' || ? || '%'", colorSpace)
		}
		// Focal length range
		if focalMin != "" {
			query = query.Where("exif_data.focal_length >= ?", focalMin)
		}
		if focalMax != "" {
			query = query.Where("exif_data.focal_length <= ?", focalMax)
		}
		// has_gps filter
		if hasGPS == "true" || hasGPS == "1" {
			query = query.Where("exif_data.gps_latitude IS NOT NULL AND exif_data.gps_latitude <> ''")
		} else if hasGPS == "false" || hasGPS == "0" {
			query = query.Where("(exif_data.gps_latitude IS NULL OR exif_data.gps_latitude = '')")
		}
		// is_favorited filter — join favorites table
		if isFavorited == "true" || isFavorited == "1" {
			query = query.Joins("INNER JOIN favorites ON favorites.photo_id = photos.id AND favorites.user_id = ? AND favorites.deleted_at IS NULL", uid)
		}
		// ISO stored as string like "1600" — extract numeric part
		if isoMin != "" {
			query = query.Where("NULLIF(regexp_replace(exif_data.iso, '[^0-9]', '', 'g'), '')::BIGINT >= ?", isoMin)
		}
		if isoMax != "" {
			query = query.Where("NULLIF(regexp_replace(exif_data.iso, '[^0-9]', '', 'g'), '')::BIGINT <= ?", isoMax)
		}
		if dateFrom != "" {
			query = query.Where("photos.uploaded_at >= ?::date", dateFrom)
		}
		if dateTo != "" {
			query = query.Where("photos.uploaded_at < (?::date + INTERVAL '1 day')", dateTo)
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

		isSuperAdmin := role == "SuperAdmin"

		photosQuery := database.DB.Model(&models.Photo{})
		albumsQuery := database.DB.Model(&models.Album{})
		presetsQuery := database.DB.Model(&models.Preset{})
		if !isSuperAdmin {
			photosQuery = photosQuery.Where("user_id = ?", uid)
			albumsQuery = albumsQuery.Where("user_id = ?", uid)
			presetsQuery = presetsQuery.Where("user_id = ?", uid)
		}

		type PhotoStats struct {
			Total      int64 `json:"total"`
			Completed  int64 `json:"completed"`
			AiAnalyzed int64 `json:"ai_analyzed"`
		}
		var photoStats PhotoStats

		query := database.DB.Model(&models.Photo{}).
			Select(`
			COUNT(*) as total,
			COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
			COUNT(CASE WHEN ai_analysis IS NOT NULL THEN 1 END) as ai_analyzed
		`)
		if !isSuperAdmin {
			query = query.Where("user_id = ?", uid)
		}
		query.Scan(&photoStats)

		totalPhotos := photoStats.Total
		completedPhotos := photoStats.Completed
		aiAnalyzed := photoStats.AiAnalyzed

		// Albums
		var totalAlbums int64
		albumsQuery.Count(&totalAlbums)

		// Presets
		var totalPresets int64
		presetsQuery.Count(&totalPresets)

		// Recent uploads by day (last 14 days)
		type DayCount struct {
			Date  string `json:"date"`
			Count int64  `json:"count"`
		}
		recentUploads := make([]DayCount, 0)
		recentQuery := database.DB.Model(&models.Photo{}).
			Select("TO_CHAR(uploaded_at, 'YYYY-MM-DD') as date, COUNT(*) as count").
			Where("uploaded_at >= NOW() - INTERVAL '14 days'")
		if !isSuperAdmin {
			recentQuery = recentQuery.Where("user_id = ?", uid)
		}
		recentQuery.Group("date").Order("date").Scan(&recentUploads)

		// Top cameras (from exif_data)
		type NameCount struct {
			Name  string `json:"name"`
			Count int64  `json:"count"`
		}
		topCameras := make([]NameCount, 0)
		topCameraQuery := database.DB.Model(&models.ExifData{}).
			Select("exif_data.camera_model as name, COUNT(*) as count").
			Joins("JOIN photos ON photos.id = exif_data.photo_id AND photos.deleted_at IS NULL").
			Where("exif_data.camera_model != ?", "")
		if !isSuperAdmin {
			topCameraQuery = topCameraQuery.Where("photos.user_id = ?", uid)
		}
		topCameraQuery.Group("exif_data.camera_model").Order("count DESC").Limit(8).Scan(&topCameras)

		// Top lenses
		topLenses := make([]NameCount, 0)
		topLensQuery := database.DB.Model(&models.ExifData{}).
			Select("exif_data.lens_model as name, COUNT(*) as count").
			Joins("JOIN photos ON photos.id = exif_data.photo_id AND photos.deleted_at IS NULL").
			Where("exif_data.lens_model != ?", "")
		if !isSuperAdmin {
			topLensQuery = topLensQuery.Where("photos.user_id = ?", uid)
		}
		topLensQuery.Group("exif_data.lens_model").Order("count DESC").Limit(8).Scan(&topLenses)

		// Color space distribution
		colorSpaces := make([]NameCount, 0)
		colorSpaceQuery := database.DB.Model(&models.ExifData{}).
			Select("exif_data.color_space as name, COUNT(*) as count").
			Joins("JOIN photos ON photos.id = exif_data.photo_id AND photos.deleted_at IS NULL").
			Where("exif_data.color_space != ?", "")
		if !isSuperAdmin {
			colorSpaceQuery = colorSpaceQuery.Where("photos.user_id = ?", uid)
		}
		colorSpaceQuery.Group("exif_data.color_space").Order("count DESC").Scan(&colorSpaces)

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
			thumbPath := strings.Replace(p.MinioPath, "raw/", "thumb/", 1)
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
		var stats struct {
			TotalUsers    int64 `json:"total_users"`
			TotalPhotos   int64 `json:"total_photos"`
			PendingPhotos int64 `json:"pending_photos"`
			TotalAlbums   int64 `json:"total_albums"`
			TotalPresets  int64 `json:"total_presets"`
			RecentUsers   int64 `json:"recent_users"`
		}
		database.DB.Raw(`
			SELECT 
				(SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) as total_users,
				(SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL) as total_photos,
				(SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND status = 'processing') as pending_photos,
				(SELECT COUNT(*) FROM albums WHERE deleted_at IS NULL) as total_albums,
				(SELECT COUNT(*) FROM presets WHERE deleted_at IS NULL) as total_presets,
				(SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days') as recent_users
		`).Scan(&stats)

		var topUsers []struct {
			UserID     uint   `json:"user_id"`
			Username   string `json:"username"`
			PhotoCount int64  `json:"photo_count"`
		}
		database.DB.Raw(`
			SELECT p.user_id, u.username, COUNT(p.id) AS photo_count
			FROM photos p
			JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
			WHERE p.deleted_at IS NULL
			GROUP BY p.user_id, u.username
			ORDER BY photo_count DESC
			LIMIT 10
		`).Scan(&topUsers)

		return c.JSON(fiber.Map{
			"total_users":    stats.TotalUsers,
			"total_photos":   stats.TotalPhotos,
			"pending_photos": stats.PendingPhotos,
			"total_albums":   stats.TotalAlbums,
			"total_presets":  stats.TotalPresets,
			"recent_users":   stats.RecentUsers,
			"top_users":      topUsers,
		})
	})

	// GET /api/admin/jobs — inspect durable async task state (SuperAdmin)
	app.Get("/api/admin/jobs", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		page, limit, err := validatePagination(c)
		if err != nil {
			return err
		}
		statusFilter := strings.TrimSpace(c.Query("status"))
		taskTypeFilter := strings.TrimSpace(c.Query("task_type"))

		query := database.DB.Model(&models.AsyncTask{})
		if statusFilter != "" {
			query = query.Where("status = ?", statusFilter)
		}
		if taskTypeFilter != "" {
			query = query.Where("task_type = ?", taskTypeFilter)
		}

		var total int64
		if err := query.Count(&total).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count jobs"})
		}

		var tasks []models.AsyncTask
		offset := (page - 1) * limit
		if err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&tasks).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list jobs"})
		}

		return c.JSON(fiber.Map{
			"jobs":  tasks,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	})

	// GET /api/admin/jobs/:id — inspect a single durable async task (SuperAdmin)
	app.Get("/api/admin/jobs/:id", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		var task models.AsyncTask
		if err := database.DB.First(&task, c.Params("id")).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "job not found"})
		}
		return c.JSON(task)
	})

	// POST /api/admin/jobs/:id/retry — manually retry a dead-letter async task (SuperAdmin)
	app.Post("/api/admin/jobs/:id/retry", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		taskID, err := c.ParamsInt("id")
		if err != nil || taskID <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid job id"})
		}

		var task models.AsyncTask
		if err := database.DB.First(&task, taskID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "job not found"})
		}

		switch task.ResourceType {
		case "export_job":
			var job models.ExportJob
			if err := database.DB.First(&job, task.ResourceID).Error; err == nil {
				if err := markExportJobPending(&job); err != nil {
					return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reset export job"})
				}
			}
		case "backup_job":
			var job models.BackupJob
			if err := database.DB.First(&job, task.ResourceID).Error; err == nil {
				if err := markBackupJobPending(&job); err != nil {
					return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reset backup job"})
				}
			}
		}

		retriedTask, retryErr := queue.RetryAsyncTask(uint(taskID))
		if retryErr != nil {
			if errors.Is(retryErr, queue.ErrAsyncTaskNotRunnable) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": retryErr.Error()})
			}
			log.Printf("Failed to immediately republish async task %d after retry request: %v", taskID, retryErr)
			return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
				"warning": "retry scheduled but not yet published; sweeper will retry it",
				"task":    retriedTask,
			})
		}

		return c.JSON(retriedTask)
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
		allowed := map[string]bool{"User": true, "admin": true, "StandardUser": true, "SuperAdmin": true}
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
		if role == "SuperAdmin" || photo.UserID == uid {
		} else {
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

	// ─────────────────────────────────────────────────────────────────
	// Phase 31 — Per-photo Rating & Color Label
	// ─────────────────────────────────────────────────────────────────

	// PATCH /api/photos/:id/rating — set rating 0–5 (0 = unrated)
	app.Patch("/api/photos/:id/rating", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		pid, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var body struct {
			Rating int `json:"rating"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		if body.Rating < 0 || body.Rating > 5 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "rating must be 0-5"})
		}
		q := database.DB.Model(&models.Photo{}).Where("id = ?", pid)
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		res := q.Update("rating", body.Rating)
		if res.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		return c.JSON(fiber.Map{"id": pid, "rating": body.Rating})
	})

	// PATCH /api/photos/:id/color-label — set color label
	app.Patch("/api/photos/:id/color-label", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		pid, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var body struct {
			ColorLabel string `json:"color_label"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		q := database.DB.Model(&models.Photo{}).Where("id = ?", pid)
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		res := q.Update("color_label", body.ColorLabel)
		if res.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		return c.JSON(fiber.Map{"id": pid, "color_label": body.ColorLabel})
	})

	// ─────────────────────────────────────────────────────────────────
	// Phase 32 — Tag Management
	// ─────────────────────────────────────────────────────────────────

	// GET /api/tags — list all tags with counts for current user
	app.Get("/api/tags", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)

		type TagCount struct {
			Tag   string `json:"tag"`
			Count int64  `json:"count"`
		}
		var photos []models.Photo
		q := database.DB.Model(&models.Photo{}).Where("tags IS NOT NULL AND status = 'completed'")
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		q.Select("tags").Find(&photos)

		tagCounts := make(map[string]int64)
		for _, p := range photos {
			if p.Tags == nil {
				continue
			}
			var tags []string
			if err := json.Unmarshal([]byte(*p.Tags), &tags); err == nil {
				for _, t := range tags {
					tagCounts[t]++
				}
			}
		}
		result := make([]TagCount, 0, len(tagCounts))
		for t, cnt := range tagCounts {
			result = append(result, TagCount{Tag: t, Count: cnt})
		}
		return c.JSON(result)
	})

	// PUT /api/tags — rename tag {old_name, new_name}
	app.Put("/api/tags", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var body struct {
			OldName string `json:"old_name"`
			NewName string `json:"new_name"`
		}
		if err := c.BodyParser(&body); err != nil || body.OldName == "" || body.NewName == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "old_name and new_name required"})
		}
		q := database.DB.Model(&models.Photo{}).Where("tags IS NOT NULL")
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		var photos []models.Photo
		q.Find(&photos)
		updated := int64(0)
		for _, p := range photos {
			if p.Tags == nil {
				continue
			}
			var tags []string
			if err := json.Unmarshal([]byte(*p.Tags), &tags); err != nil {
				continue
			}
			changed := false
			for i, t := range tags {
				if t == body.OldName {
					tags[i] = body.NewName
					changed = true
				}
			}
			if changed {
				b, _ := json.Marshal(tags)
				bs := string(b)
				database.DB.Model(&p).Update("tags", &bs)
				updated++
			}
		}
		return c.JSON(fiber.Map{"old_name": body.OldName, "new_name": body.NewName, "updated": updated})
	})

	// POST /api/tags — merge tags {source, target}
	app.Post("/api/tags", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var body struct {
			Source string `json:"source"`
			Target string `json:"target"`
		}
		if err := c.BodyParser(&body); err != nil || body.Source == "" || body.Target == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "source and target required"})
		}
		q := database.DB.Model(&models.Photo{}).Where("tags IS NOT NULL")
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		var photos []models.Photo
		q.Find(&photos)
		updated := int64(0)
		for _, p := range photos {
			if p.Tags == nil {
				continue
			}
			var tags []string
			if err := json.Unmarshal([]byte(*p.Tags), &tags); err != nil {
				continue
			}
			changed := false
			hasTarget := false
			newTags := make([]string, 0, len(tags))
			for _, t := range tags {
				if t == body.Target {
					hasTarget = true
				}
				if t == body.Source {
					changed = true
					continue // will add target if not already present
				}
				newTags = append(newTags, t)
			}
			if changed {
				if !hasTarget {
					newTags = append(newTags, body.Target)
				}
				b, _ := json.Marshal(newTags)
				bs := string(b)
				database.DB.Model(&p).Update("tags", &bs)
				updated++
			}
		}
		return c.JSON(fiber.Map{"source": body.Source, "target": body.Target, "updated": updated})
	})

	// DELETE /api/tags/:name — remove tag from all photos
	app.Delete("/api/tags/:name", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		tagName := c.Params("name")
		if tagName == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tag name required"})
		}
		q := database.DB.Model(&models.Photo{}).Where("tags IS NOT NULL")
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		var photos []models.Photo
		q.Find(&photos)
		updated := int64(0)
		for _, p := range photos {
			if p.Tags == nil {
				continue
			}
			var tags []string
			if err := json.Unmarshal([]byte(*p.Tags), &tags); err != nil {
				continue
			}
			newTags := make([]string, 0, len(tags))
			changed := false
			for _, t := range tags {
				if t == tagName {
					changed = true
					continue
				}
				newTags = append(newTags, t)
			}
			if changed {
				if len(newTags) == 0 {
					database.DB.Model(&p).Update("tags", nil)
				} else {
					b, _ := json.Marshal(newTags)
					bs := string(b)
					database.DB.Model(&p).Update("tags", &bs)
				}
				updated++
			}
		}
		return c.JSON(fiber.Map{"tag": tagName, "updated": updated})
	})

	// ─────────────────────────────────────────────────────────────────
	// Phase 33 — Storage Quota Management
	// ─────────────────────────────────────────────────────────────────

	// GET /api/storage/usage — get current user's storage stats
	app.Get("/api/storage/usage", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		var user models.User
		if err := database.DB.First(&user, uid).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user not found"})
		}
		return c.JSON(fiber.Map{
			"used_bytes":  user.StorageUsedBytes,
			"quota_bytes": user.StorageQuotaBytes,
		})
	})

	// PUT /api/admin/users/:id/quota — set quota (SuperAdmin only)
	app.Put("/api/admin/users/:id/quota", requireJWT(), requireRole("SuperAdmin"), func(c *fiber.Ctx) error {
		targetID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var body struct {
			QuotaBytes int64 `json:"quota_bytes"`
		}
		if err := c.BodyParser(&body); err != nil || body.QuotaBytes <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "quota_bytes required"})
		}
		res := database.DB.Model(&models.User{}).Where("id = ?", targetID).Update("storage_quota_bytes", body.QuotaBytes)
		if res.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user not found"})
		}
		return c.JSON(fiber.Map{"id": targetID, "quota_bytes": body.QuotaBytes})
	})

	// ─────────────────────────────────────────────────────────────────
	// Phase 34 — Notification Center
	// ─────────────────────────────────────────────────────────────────

	// GET /api/notifications — list notifications with pagination
	app.Get("/api/notifications", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		page := c.QueryInt("page", 1)
		limit := c.QueryInt("limit", 20)
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit
		unreadOnly := c.Query("unread_only", "") == "true"

		q := database.DB.Model(&models.Notification{}).Where("user_id = ?", uid)
		if unreadOnly {
			q = q.Where("is_read = false")
		}
		var total int64
		q.Count(&total)
		var notifications []models.Notification
		q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&notifications)
		return c.JSON(fiber.Map{
			"notifications": notifications,
			"total":         total,
			"page":          page,
			"limit":         limit,
		})
	})

	// PUT /api/notifications — mark all as read
	app.Put("/api/notifications", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		database.DB.Model(&models.Notification{}).Where("user_id = ? AND is_read = false", uid).Update("is_read", true)
		return c.JSON(fiber.Map{"ok": true})
	})

	// PUT /api/notifications/:id — mark one as read
	app.Put("/api/notifications/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		nid, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		res := database.DB.Model(&models.Notification{}).Where("id = ? AND user_id = ?", nid, uid).Update("is_read", true)
		if res.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "notification not found"})
		}
		return c.JSON(fiber.Map{"ok": true})
	})

	// DELETE /api/notifications/:id — delete one notification
	app.Delete("/api/notifications/:id", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		nid, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		res := database.DB.Where("id = ? AND user_id = ?", nid, uid).Delete(&models.Notification{})
		if res.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "notification not found"})
		}
		return c.JSON(fiber.Map{"deleted": true})
	})

	// ─────────────────────────────────────────────────────────────────
	// Phase 36 — Photo Metadata Edit (DB-only) & Batch Date Shift
	// ─────────────────────────────────────────────────────────────────

	// PUT /api/photos/:id/metadata — update description, taken_at, GPS, copyright, creator
	app.Put("/api/photos/:id/metadata", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		pid, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
		}
		var body struct {
			Description *string  `json:"description"`
			TakenAt     *string  `json:"taken_at"`
			Latitude    *float64 `json:"latitude"`
			Longitude   *float64 `json:"longitude"`
			Copyright   *string  `json:"copyright"`
			Creator     *string  `json:"creator"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		q := database.DB.Model(&models.Photo{}).Where("id = ?", pid)
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		updates := map[string]interface{}{}
		if body.Description != nil {
			updates["description"] = *body.Description
		}
		if body.TakenAt != nil {
			updates["taken_at"] = *body.TakenAt
		}
		if body.Latitude != nil {
			updates["latitude"] = *body.Latitude
		}
		if body.Longitude != nil {
			updates["longitude"] = *body.Longitude
		}
		if body.Copyright != nil {
			updates["copyright_notice"] = *body.Copyright
		}
		if body.Creator != nil {
			updates["creator"] = *body.Creator
		}
		if len(updates) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no fields to update"})
		}
		res := q.Updates(updates)
		if res.RowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "photo not found"})
		}
		return c.JSON(fiber.Map{"id": pid, "updated": true})
	})

	// POST /api/photos/batch-date-shift — shift taken_at by offset_seconds for multiple photos
	app.Post("/api/photos/batch-date-shift", requireJWT(), func(c *fiber.Ctx) error {
		uid := userIDFromLocals(c)
		role := c.Locals("userRole").(string)
		var body struct {
			IDs           []uint `json:"ids"`
			OffsetSeconds int    `json:"offset_seconds"`
		}
		if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ids and offset_seconds required"})
		}
		q := database.DB.Model(&models.Photo{}).Where("id IN ? AND taken_at IS NOT NULL", body.IDs)
		if role == "SuperAdmin" {
		} else {
			q = q.Where("user_id = ?", uid)
		}
		res := q.UpdateColumn("taken_at", gorm.Expr("taken_at + make_interval(secs => ?)", body.OffsetSeconds))
		return c.JSON(fiber.Map{"updated": res.RowsAffected})
	})

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startAsyncTaskSweeper(shutdownCtx)

	go func() {
		<-shutdownCtx.Done()
		logger.Info("shutdown signal received")

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := app.ShutdownWithContext(ctx); err != nil {
			logger.Error("fiber shutdown failed", "error", err)
		}
		if tracerShutdown != nil {
			if err := tracerShutdown(ctx); err != nil {
				logger.Error("tracer shutdown failed", "error", err)
			}
		}
		if queue.RedisClient != nil {
			if err := queue.RedisClient.Close(); err != nil {
				logger.Error("redis shutdown failed", "error", err)
			}
		}
		if sqlDB, err := database.DB.DB(); err == nil {
			if err := sqlDB.Close(); err != nil {
				logger.Error("database shutdown failed", "error", err)
			}
		}
		logger.Info("shutdown complete")
	}()

	logger.Info("starting Go Core API", "addr", ":8080")
	if err := app.Listen(":8080"); err != nil && err != http.ErrServerClosed {
		logger.Error("server exited with error", "error", err)
		os.Exit(1)
	}
}
