package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"photogiraffe/core/database"
	"photogiraffe/core/models"
	"photogiraffe/core/queue"

	"github.com/gofiber/fiber/v2"
)

func requestTraceparent(c *fiber.Ctx) string {
	traceparent := c.Get("Traceparent")
	if traceparent == "" {
		traceparent = c.Get("traceparent")
	}
	return traceparent
}

func markExportJobPending(job *models.ExportJob) error {
	updates := map[string]interface{}{
		"status":        "pending",
		"output_path":   "",
		"error_message": "",
		"completed_at":  nil,
	}
	if err := database.DB.Model(job).Updates(updates).Error; err != nil {
		return err
	}
	job.Status = "pending"
	job.OutputPath = ""
	job.ErrorMessage = ""
	job.CompletedAt = nil
	return nil
}

func markExportJobProcessing(job *models.ExportJob) error {
	if job.Status == "processing" {
		return nil
	}
	if err := database.DB.Model(job).Updates(map[string]interface{}{"status": "processing"}).Error; err != nil {
		return err
	}
	job.Status = "processing"
	return nil
}

func markExportJobCompleted(job *models.ExportJob, outputPath string) error {
	wasTerminal := job.Status == "completed" || job.Status == "failed"
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":        "completed",
		"output_path":   outputPath,
		"error_message": "",
		"completed_at":  &now,
	}
	if err := database.DB.Model(job).Updates(updates).Error; err != nil {
		return err
	}
	job.Status = "completed"
	job.OutputPath = outputPath
	job.ErrorMessage = ""
	job.CompletedAt = &now
	if !wasTerminal {
		payload, _ := jsonMarshal(map[string]interface{}{
			"job_id":   job.ID,
			"photo_id": job.PhotoID,
			"status":   job.Status,
		})
		createNotification(job.UserID, "export_done", "导出已完成", "导出任务 #"+strconv.FormatUint(uint64(job.ID), 10)+" 已完成，可前往下载。")
		broadcastToUser(job.UserID, "export_completed", payload)
	}
	return nil
}

func markExportJobFailed(job *models.ExportJob, errorMessage string) error {
	wasTerminal := job.Status == "completed" || job.Status == "failed"
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":        "failed",
		"error_message": errorMessage,
		"completed_at":  &now,
	}
	if err := database.DB.Model(job).Updates(updates).Error; err != nil {
		return err
	}
	job.Status = "failed"
	job.ErrorMessage = errorMessage
	job.CompletedAt = &now
	if !wasTerminal {
		payload, _ := jsonMarshal(map[string]interface{}{
			"job_id":   job.ID,
			"photo_id": job.PhotoID,
			"status":   job.Status,
		})
		createNotification(job.UserID, "export_failed", "导出失败", "导出任务 #"+strconv.FormatUint(uint64(job.ID), 10)+" 失败："+errorMessage)
		broadcastToUser(job.UserID, "export_failed", payload)
	}
	return nil
}

func markBackupJobPending(job *models.BackupJob) error {
	updates := map[string]interface{}{
		"status":        "pending",
		"output_path":   "",
		"error_message": "",
		"completed_at":  nil,
	}
	if err := database.DB.Model(job).Updates(updates).Error; err != nil {
		return err
	}
	job.Status = "pending"
	job.OutputPath = ""
	job.ErrorMessage = ""
	job.CompletedAt = nil
	return nil
}

func markBackupJobProcessing(job *models.BackupJob) error {
	if job.Status == "processing" {
		return nil
	}
	if err := database.DB.Model(job).Updates(map[string]interface{}{"status": "processing"}).Error; err != nil {
		return err
	}
	job.Status = "processing"
	return nil
}

func markBackupJobCompleted(job *models.BackupJob, outputPath string) error {
	wasTerminal := job.Status == "completed" || job.Status == "failed"
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":        "completed",
		"output_path":   outputPath,
		"error_message": "",
		"completed_at":  &now,
	}
	if err := database.DB.Model(job).Updates(updates).Error; err != nil {
		return err
	}
	job.Status = "completed"
	job.OutputPath = outputPath
	job.ErrorMessage = ""
	job.CompletedAt = &now
	if !wasTerminal {
		payload, _ := jsonMarshal(map[string]interface{}{
			"job_id":        job.ID,
			"status":        job.Status,
			"output_path":   job.OutputPath,
			"error_message": job.ErrorMessage,
		})
		createNotification(job.UserID, "backup_done", "备份已完成", "备份任务 #"+strconv.FormatUint(uint64(job.ID), 10)+" 已完成，可下载备份文件。")
		broadcastToUser(job.UserID, "backup_completed", payload)
	}
	return nil
}

func markBackupJobFailed(job *models.BackupJob, errorMessage string) error {
	wasTerminal := job.Status == "completed" || job.Status == "failed"
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":        "failed",
		"error_message": errorMessage,
		"completed_at":  &now,
	}
	if err := database.DB.Model(job).Updates(updates).Error; err != nil {
		return err
	}
	job.Status = "failed"
	job.ErrorMessage = errorMessage
	job.CompletedAt = &now
	if !wasTerminal {
		payload, _ := jsonMarshal(map[string]interface{}{
			"job_id":        job.ID,
			"status":        job.Status,
			"output_path":   job.OutputPath,
			"error_message": job.ErrorMessage,
		})
		createNotification(job.UserID, "backup_failed", "备份失败", "备份任务 #"+strconv.FormatUint(uint64(job.ID), 10)+" 失败："+errorMessage)
		broadcastToUser(job.UserID, "backup_failed", payload)
	}
	return nil
}

func handleTerminalAsyncTaskFailure(task *models.AsyncTask) {
	switch task.ResourceType {
	case "export_job":
		var job models.ExportJob
		if err := database.DB.First(&job, task.ResourceID).Error; err == nil {
			if err := markExportJobFailed(&job, task.LastError); err != nil {
				log.Printf("failed to mark export job %d as failed after dead letter: %v", job.ID, err)
			}
		}
	case "backup_job":
		var job models.BackupJob
		if err := database.DB.First(&job, task.ResourceID).Error; err == nil {
			if err := markBackupJobFailed(&job, task.LastError); err != nil {
				log.Printf("failed to mark backup job %d as failed after dead letter: %v", job.ID, err)
			}
		}
	}
}

func startAsyncTaskSweeper(ctx context.Context) {
	if stringsEqualFold(os.Getenv("ASYNC_TASK_SWEEPER_ENABLED"), "false") {
		logger.Info("async task sweeper disabled")
		return
	}
	interval := 15 * time.Second
	if raw := os.Getenv("ASYNC_TASK_SWEEPER_INTERVAL_SECONDS"); raw != "" {
		if seconds, err := strconv.Atoi(raw); err == nil && seconds > 0 {
			interval = time.Duration(seconds) * time.Second
		}
	}
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				reclaimed, err := queue.ReclaimExpiredAsyncTasks(50)
				if err != nil {
					logger.Error("async task reclaim sweep failed", "error", err)
				} else if reclaimed > 0 {
					logger.Warn("reclaimed stale async tasks", "count", reclaimed)
				}
				published, err := queue.PublishDueAsyncTasks(50)
				if err != nil {
					logger.Error("async task publish sweep failed", "error", err)
				} else if published > 0 {
					logger.Info("republished async tasks", "count", published)
				}
			}
		}
	}()
}

func jsonMarshal(v interface{}) (string, error) {
	bytes, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func stringsEqualFold(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
