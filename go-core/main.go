package main

import (
	"fmt"
	"log"
	"net/http"
	"photogiraffe/core/database"
	"photogiraffe/core/models"
)

func main() {
	// Initialize Database Connection
	database.Connect()

	// Auto Migrate Models
	err := database.DB.AutoMigrate(&models.User{}, &models.Photo{}, &models.ExifData{}, &models.FeatureFlag{})
	if err != nil {
		log.Fatal("Failed to auto migrate database: ", err)
	}
	fmt.Println("Database migration completed successfully.")

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		// Check DB connection
		sqlDB, err := database.DB.DB()
		if err != nil || sqlDB.Ping() != nil {
			http.Error(w, "Database connection failed", http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(w, "Go Core API is healthy! Database connection is active.")
	})

	fmt.Println("Starting Go Core API on :8080...")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}