package models

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Username     string `gorm:"uniqueIndex;not null"`
	Email        string `gorm:"uniqueIndex;not null"`
	PasswordHash string `gorm:"not null"`
	Role         string `gorm:"default:'StandardUser'"` // e.g., SuperAdmin, StandardUser
	Photos       []Photo
}

type Photo struct {
	gorm.Model
	UserID           uint
	OriginalFilename string `gorm:"not null"`
	MinioPath        string `gorm:"not null"`
	Status           string `gorm:"default:'processing'"` // e.g., processing, completed, failed
	UploadedAt       time.Time
	ExifData         ExifData
	AIAnalysis       *string `gorm:"type:jsonb"` // nullable; NULL until AI analysis is completed
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
}

type FeatureFlag struct {
	gorm.Model
	FeatureName string `gorm:"uniqueIndex;not null"`
	IsEnabled   bool   `gorm:"default:false"`
	Description string
}

type AIConfig struct {
	gorm.Model
	Provider  string `gorm:"not null;default:'openai_compatible'"` // openai | google | anthropic | zhipu | deepseek | minimax | openai_compatible
	BaseURL   string // optional: required only for openai_compatible provider
	APIKey    string `gorm:"not null"`
	ModelName string `gorm:"not null"`
}

// ExportJob tracks a photo export request through the pipeline.
type ExportJob struct {
	gorm.Model
	PhotoID       uint       `gorm:"not null;index"`
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
}
