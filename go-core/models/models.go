package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	PublicID          string `gorm:"uniqueIndex"` // UUID v4 — safe for external exposure; auto-set by BeforeCreate
	Username          string `gorm:"uniqueIndex;not null"`
	Email             string `gorm:"uniqueIndex;not null"`
	PasswordHash      string `gorm:"not null"`
	Role              string `gorm:"default:'StandardUser'"` // e.g., SuperAdmin, StandardUser
	Photos            []Photo
	// ─── Phase 33 — Storage Quota ───
	StorageQuotaBytes int64  `gorm:"default:10737418240"` // 10 GB default
	StorageUsedBytes  int64  `gorm:"default:0"`
}

// BeforeCreate auto-generates a UUID v4 PublicID if not already set.
func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.PublicID == "" {
		u.PublicID = uuid.New().String()
	}
	return nil
}

type Photo struct {
	gorm.Model
	UserID           uint
	OriginalFilename string `gorm:"not null"`
	MinioPath        string `gorm:"not null"`
	Status           string `gorm:"default:'processing'"` // processing | completed | failed
	UploadedAt       time.Time
	IsPublic         bool    `gorm:"default:false"` // visible on public portfolio page
	Description      string  `gorm:"type:text"`     // photographer's caption / note
	Tags             *string `gorm:"type:jsonb"`    // JSON string array e.g. ["portrait","night"]; pointer so zero value is NULL (valid jsonb)
	ExifData         ExifData
	AIAnalysis       *string `gorm:"type:jsonb"` // nullable; NULL until AI analysis is completed
	InferredParams   *string `gorm:"type:jsonb"` // nullable; AI-inferred colour-adjustment parameters
	AppliedPresetID  *uint   // nullable; last preset explicitly applied
	DominantColors   *string `gorm:"type:jsonb"`    // nullable; [{hex,bucket,pct},...] extracted by worker
	PHash            *string `gorm:"type:varchar(16)"` // nullable; 64-bit perceptual hash as 16-char hex, computed by worker
	AutoTags         *string `gorm:"type:jsonb"`    // nullable; AI auto-tags from CLIP zero-shot classification
	// ─── Phase 31 ───
	Rating     int    `gorm:"default:0"`  // 0 = unrated, 1–5
	ColorLabel string `gorm:"default:''"` // "" | red | orange | yellow | green | blue | purple
}

// AIRateLimit configures call-rate limits for the AI analysis endpoint.
// TargetType="user" applies to a single user (TargetUserID set);
// TargetType="all"  applies globally to every authenticated user.
type AIRateLimit struct {
	gorm.Model
	TargetType   string `gorm:"not null;default:'all'"`  // "user" | "all"
	TargetUserID *uint  // nil when TargetType="all"
	Window       string `gorm:"not null"`               // "second" | "minute" | "hour" | "day" | "week" | "month"
	MaxRequests  int    `gorm:"not null;default:10"`
	Enabled      bool   `gorm:"default:true"`
	Note         string // optional admin-visible note
}

type ExifData struct {
	gorm.Model
	PhotoID          uint
	CameraModel      string
	LensModel        string
	FocalLength      string
	Aperture         string
	ShutterSpeed     string
	ISO              string
	ColorSpace       string // e.g., sRGB, Adobe RGB, Display P3
	ICCProfileName   string // Full ICC profile name from embedded metadata
	GPSLatitude      string
	GPSLongitude     string
	Software         string
	DateTimeOriginal string
	// IPTC / XMP fields (extracted on upload, written on export)
	Copyright string // dc:rights / EXIF Copyright
	Creator   string // dc:creator / EXIF Artist
}

type FeatureFlag struct {
	gorm.Model
	FeatureName string `gorm:"uniqueIndex;not null"`
	IsEnabled   bool   `gorm:"default:false"`
	Description string
}

type AIConfig struct {
	gorm.Model
	Provider       string `gorm:"not null;default:'openai_compatible'"` // openai | google | anthropic | zhipu | deepseek | minimax | openai_compatible
	BaseURL        string // optional: required only for openai_compatible provider
	APIKey         string `gorm:"not null"`
	ModelName      string `gorm:"not null"`
	PromptLanguage string `gorm:"default:'en'"` // "en" | "zh" — controls prompt language for AI analysis & param inference
}

// ExportJob tracks a photo export request through the pipeline.
type ExportJob struct {
	gorm.Model
	PhotoID       uint       `gorm:"not null;index"`
	AlbumID       *uint      `gorm:"index"`           // non-nil for album export jobs
	JobType       string     `gorm:"default:'photo'"` // photo | album
	UserID        uint       `gorm:"not null;index"`
	Status        string     `gorm:"default:'pending'"` // pending | processing | completed | failed
	ExportOptions string     `gorm:"type:jsonb"`        // serialized ExportOptions JSON
	OutputPath    string     // MinIO path of the exported file (set when completed)
	ErrorMessage  string     // error detail (set when failed)
	CompletedAt   *time.Time // nullable; set when status transitions to completed/failed
}

// Preset stores a named set of colour-adjustment parameters for reuse.
type Preset struct {
	gorm.Model
	UserID       uint   `gorm:"not null;index"`
	Name         string `gorm:"not null"`
	Description  string
	AdjustParams string `gorm:"type:jsonb;not null"` // serialized AdjustParams JSON
	Platforms    string `gorm:"type:jsonb"`          // JSON array, e.g. ["Lightroom","Capture One"]
	FilePath     string // MinIO path for downloadable preset file
}

// RefreshToken keeps a hashed record of an issued refresh token.
type RefreshToken struct {
	gorm.Model
	UserID    uint      `gorm:"not null;index"`
	TokenHash string    `gorm:"not null;uniqueIndex"` // SHA-256 hex of the raw token
	ExpiresAt time.Time `gorm:"not null"`
	Revoked   bool      `gorm:"default:false"`
}

// ShareLink enables unauthenticated public access to a single photo.
type ShareLink struct {
	gorm.Model
	PhotoID   uint       `gorm:"not null;index"`
	UserID    uint       `gorm:"not null;index"`       // creator
	Token     string     `gorm:"not null;uniqueIndex"` // 32-byte hex random token
	ExpiresAt *time.Time // nil = never expires
	IsRevoked bool       `gorm:"default:false"`
}

// InviteCode is a single-use registration token generated by a SuperAdmin.
type InviteCode struct {
	gorm.Model
	Code      string     `gorm:"not null;uniqueIndex"`
	CreatedBy uint       `gorm:"not null;index"` // SuperAdmin user ID
	UsedBy    *uint      // nil until redeemed
	UsedAt    *time.Time // nil until redeemed
	ExpiresAt *time.Time // nil = never expires
}

// Album is a named collection of photos belonging to a user.
type Album struct {
	gorm.Model
	UserID       uint   `gorm:"not null;index"`
	Name         string `gorm:"not null"`
	Description  string
	CoverPhotoID *uint   // nil = no explicit cover (use first photo)
	ShareToken   string  `gorm:"uniqueIndex"` // empty = not shared
	Photos       []Photo `gorm:"many2many:album_photos;"`
}

// AlbumPhoto is the join table between Album and Photo.
type AlbumPhoto struct {
	AlbumID uint      `gorm:"primaryKey"`
	PhotoID uint      `gorm:"primaryKey"`
	AddedAt time.Time `gorm:"autoCreateTime"`
}

// UserProfile stores extended photographer identity for a user (one-to-one).
type UserProfile struct {
	gorm.Model
	UserID        uint   `gorm:"not null;uniqueIndex"` // FK → users.id
	Bio           string `gorm:"type:text"`
	AvatarPath    string // MinIO path, e.g. "profiles/avatars/{uid}/{uuid}.webp"
	SignaturePath string // MinIO path, e.g. "profiles/signatures/{uid}/{uuid}.png"
	Website       string
	Location      string
}

// StorageConfig holds the active object-storage backend settings (single row, id=1).
type StorageConfig struct {
	gorm.Model
	Backend   string `gorm:"default:'minio'"` // minio | s3 | webdav
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string `gorm:"type:text"`
	RootPath  string
	UseSSL    bool `gorm:"default:true"`
	Region    string
}

// ─── Phase 22 — Account Security + SMTP ─────────────────────────────────────

// SmtpConfig holds SMTP mail server settings (single row, id=1).
type SmtpConfig struct {
	gorm.Model
	Host     string
	Port     int    `gorm:"default:587"`
	Username string
	Password string `gorm:"type:text"` // never returned in plaintext via API
	FromName string `gorm:"default:'Photogiraffe'"`
	UseTLS   bool   `gorm:"default:true"` // STARTTLS
	Enabled  bool   `gorm:"default:false"`
}

// PasswordResetToken is a one-time token for the forgot-password flow.
// Only the SHA-256 hash is stored; the raw token is sent via email.
type PasswordResetToken struct {
	gorm.Model
	UserID    uint      `gorm:"not null;index"`
	TokenHash string    `gorm:"not null;uniqueIndex"` // SHA-256 hex
	ExpiresAt time.Time `gorm:"not null"`
	Used      bool      `gorm:"default:false"`
}

// LoginHistory records the last 10 login attempts per user.
type LoginHistory struct {
	gorm.Model
	UserID    uint   `gorm:"not null;index"`
	IPAddress string
	UserAgent string `gorm:"type:text"`
	Success   bool
}

// ─── Phase 23 — Photo Notes + Timeline ──────────────────────────────────────

// PhotoNote is a timestamped text note attached to a photo by any user who
// has access to it. Multiple notes per photo are allowed.
type PhotoNote struct {
	gorm.Model
	PhotoID uint   `gorm:"not null;index"`
	UserID  uint   `gorm:"not null;index"`
	Content string `gorm:"type:text;not null"`
}

// ─── Phase 25 — Favorites / Stars ────────────────────────────────────────────

// Favorite records that a user has starred a photo (including public photos
// by other users). The (UserID, PhotoID) pair is unique.
type Favorite struct {
	gorm.Model
	UserID  uint `gorm:"not null;uniqueIndex:idx_fav_user_photo"`
	PhotoID uint `gorm:"not null;uniqueIndex:idx_fav_user_photo;index"`
}

// ─── Phase 27 — Smart Albums ──────────────────────────────────────────────────

// SmartAlbum is a dynamically-evaluated collection of photos matching a rule.
// RuleType determines how RuleParams JSON is interpreted.
//
//   date_range         {"from":"2024-01-01","to":"2024-12-31"}
//   tags_contain       {"tags":["portrait","night"]}
//   camera_model       {"model":"Sony A7 III"}
//   auto_tags_contain  {"tags":["person","sky"]}
//   color_bucket       {"bucket":"blue"}
type SmartAlbum struct {
	gorm.Model
	UserID     uint   `gorm:"not null;index"`
	Name       string `gorm:"not null"`
	RuleType   string `gorm:"not null"` // date_range | tags_contain | camera_model | auto_tags_contain | color_bucket
	RuleParams string `gorm:"type:jsonb;not null;default:'{}'"`
}

// ─── Phase 29 — Saved Searches ────────────────────────────────────────────────

// SavedSearch stores a named set of search parameters for quick re-use.
type SavedSearch struct {
	gorm.Model
	UserID uint   `gorm:"not null;index"`
	Name   string `gorm:"not null"`
	Params string `gorm:"type:text;not null;default:''"` // URL-encoded query string
}

// ─── Phase 30 — Data Backup / Export ──────────────────────────────────────────

// BackupJob tracks a full-account data-export request.
type BackupJob struct {
	gorm.Model
	UserID       uint       `gorm:"not null;index"`
	Status       string     `gorm:"default:'pending'"` // pending | processing | completed | failed
	OutputPath   string     // MinIO path of the zip file (set when completed)
	ErrorMessage string     // error detail when failed
	CompletedAt  *time.Time // nullable
}

// ─── Phase 34 — Notification Center ─────────────────────────────────────────

// Notification persists an in-app notification for a user.
type Notification struct {
	gorm.Model
	UserID uint   `gorm:"not null;index"`
	Type   string `gorm:"not null"` // upload_done | ai_done | export_done | backup_done | info
	Title  string `gorm:"not null"`
	Body   string `gorm:"type:text"`
	IsRead bool   `gorm:"default:false"`
}
