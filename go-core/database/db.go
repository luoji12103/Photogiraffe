package database

import (
	"fmt"
	"log"
	"os"
	"time"

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

	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)

	fmt.Println("Successfully connected to PostgreSQL database!")

	// Auto Migrate
	err = db.AutoMigrate(&models.User{}, &models.Photo{}, &models.ExifData{}, &models.FeatureFlag{}, &models.AIConfig{}, &models.ExportJob{}, &models.AsyncTask{}, &models.Preset{}, &models.RefreshToken{}, &models.SigningKey{}, &models.ShareLink{}, &models.InviteCode{}, &models.Album{}, &models.AlbumPhoto{}, &models.UserProfile{}, &models.StorageConfig{}, &models.AIRateLimit{}, &models.SmtpConfig{}, &models.PasswordResetToken{}, &models.LoginHistory{}, &models.PhotoNote{}, &models.Favorite{}, &models.SmartAlbum{}, &models.SavedSearch{}, &models.BackupJob{}, &models.Notification{})
	if err != nil {
		log.Fatal("Failed to auto migrate database: ", err)
	}

	db.Exec("CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_exif_data_photo_id ON exif_data(photo_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_favorites_user_photo ON favorites(user_id, photo_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_ai_rate_limit_target_user_id ON ai_rate_limit(target_user_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_async_tasks_status_next_attempt ON async_tasks(status, next_attempt_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_async_tasks_status_lease_expires ON async_tasks(status, lease_expires_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_async_tasks_task_resource ON async_tasks(task_type, resource_type, resource_id)")

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
