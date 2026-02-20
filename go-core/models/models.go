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