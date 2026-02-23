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
	err = db.AutoMigrate(&models.User{}, &models.Photo{}, &models.ExifData{}, &models.FeatureFlag{}, &models.AIConfig{}, &models.ExportJob{}, &models.Preset{}, &models.RefreshToken{}, &models.ShareLink{}, &models.InviteCode{})
	if err != nil {
		log.Fatal("Failed to auto migrate database: ", err)
	}
}
