package database

import (
	"fmt"
	"log"
	"os"

	"photogiraffe/core/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() {
	host := os.Getenv("DB_HOST")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	dbname := os.Getenv("DB_NAME")
	port := "5432"

	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=Asia/Shanghai",
		host, user, password, dbname, port)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database: ", err)
	}

	DB = db
	fmt.Println("Successfully connected to PostgreSQL database!")

	// Auto Migrate
	err = db.AutoMigrate(&models.User{}, &models.Photo{}, &models.ExifData{}, &models.FeatureFlag{}, &models.AIConfig{}, &models.ExportJob{}, &models.Preset{}, &models.RefreshToken{}, &models.ShareLink{}, &models.InviteCode{}, &models.Album{}, &models.AlbumPhoto{}, &models.UserProfile{}, &models.StorageConfig{})
	if err != nil {
		log.Fatal("Failed to auto migrate database: ", err)
	}

	// Back-fill public_id for existing users that predate the UUID migration.
	db.Exec(`UPDATE users SET public_id = gen_random_uuid()::text WHERE public_id IS NULL OR public_id = ''`)
	fmt.Println("public_id migration: back-fill complete (no-op if already populated)")

	// Ensure a default StorageConfig row exists (id=1 = current MinIO config from env).
	var sc models.StorageConfig
	if db.First(&sc, 1).Error != nil {
		db.Create(&models.StorageConfig{
			Backend:   "minio",
			Endpoint:  os.Getenv("MINIO_ENDPOINT"),
			Bucket:    "photos",
			AccessKey: os.Getenv("MINIO_ACCESS_KEY"),
			SecretKey: os.Getenv("MINIO_SECRET_KEY"),
			UseSSL:    false,
		})
	}
}
