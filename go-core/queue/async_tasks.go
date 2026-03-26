package queue

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"photogiraffe/core/database"
	"photogiraffe/core/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AsyncTaskStatusPending        = "pending"
	AsyncTaskStatusProcessing     = "processing"
	AsyncTaskStatusRetryScheduled = "retry_scheduled"
	AsyncTaskStatusCompleted      = "completed"
	AsyncTaskStatusFailed         = "failed"
	AsyncTaskStatusDeadLetter     = "dead_letter"
	AsyncTaskStatusCancelled      = "cancelled"
)

var (
	ErrAsyncTaskAlreadyActive = errors.New("async task is already active")
	ErrAsyncTaskNotRunnable   = errors.New("async task is not runnable")
)

type EnqueueAsyncTaskInput struct {
	TaskType       string
	StreamName     string
	ResourceType   string
	ResourceID     uint
	IdempotencyKey string
	Payload        map[string]interface{}
	MaxAttempts    int
	Traceparent    string
}

func asyncTaskLeaseDuration() time.Duration {
	if raw := os.Getenv("ASYNC_TASK_LEASE_SECONDS"); raw != "" {
		if seconds, err := time.ParseDuration(raw + "s"); err == nil && seconds > 0 {
			return seconds
		}
	}
	return 2 * time.Minute
}

func asyncTaskRetryDelay(attemptCount int) time.Duration {
	if attemptCount < 1 {
		attemptCount = 1
	}
	shift := attemptCount - 1
	if shift > 6 {
		shift = 6
	}
	delay := 15 * time.Second * time.Duration(1<<shift)
	if delay > 15*time.Minute {
		return 15 * time.Minute
	}
	return delay
}

func normalizeMaxAttempts(taskType string, maxAttempts int) int {
	if maxAttempts > 0 {
		return maxAttempts
	}
	switch taskType {
	case "image_processing", "export_photo", "export_album", "backup_export":
		return 5
	default:
		return 3
	}
}

func marshalTaskPayload(payload map[string]interface{}) (string, error) {
	if payload == nil {
		payload = map[string]interface{}{}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func parseTaskPayload(payload string) (map[string]interface{}, error) {
	result := map[string]interface{}{}
	if payload == "" {
		return result, nil
	}
	if err := json.Unmarshal([]byte(payload), &result); err != nil {
		return nil, err
	}
	return result, nil
}

func buildAsyncTaskEnvelope(task *models.AsyncTask, payload map[string]interface{}) map[string]interface{} {
	values := make(map[string]interface{}, len(payload)+5)
	for key, value := range payload {
		values[key] = value
	}
	values["task_id"] = task.ID
	values["task_type"] = task.TaskType
	values["attempt"] = task.AttemptCount + 1
	values["max_attempts"] = task.MaxAttempts
	if task.Traceparent != "" {
		values["traceparent"] = task.Traceparent
	}
	return values
}

func enqueueAsyncTask(input EnqueueAsyncTaskInput) (*models.AsyncTask, bool, error) {
	payloadJSON, err := marshalTaskPayload(input.Payload)
	if err != nil {
		return nil, false, err
	}
	if input.IdempotencyKey == "" {
		return nil, false, fmt.Errorf("idempotency key is required")
	}
	if input.TaskType == "" || input.StreamName == "" {
		return nil, false, fmt.Errorf("task type and stream name are required")
	}

	now := time.Now().UTC()
	task := &models.AsyncTask{}
	created := false

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("idempotency_key = ?", input.IdempotencyKey).
			First(task).Error
		if err == nil {
			switch task.Status {
			case AsyncTaskStatusPending, AsyncTaskStatusProcessing, AsyncTaskStatusRetryScheduled:
				return nil
			default:
				return fmt.Errorf("task with idempotency key %s already exists in terminal state %s", input.IdempotencyKey, task.Status)
			}
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		*task = models.AsyncTask{
			TaskType:       input.TaskType,
			StreamName:     input.StreamName,
			ResourceType:   input.ResourceType,
			ResourceID:     input.ResourceID,
			Status:         AsyncTaskStatusPending,
			IdempotencyKey: input.IdempotencyKey,
			Payload:        payloadJSON,
			MaxAttempts:    normalizeMaxAttempts(input.TaskType, input.MaxAttempts),
			NextAttemptAt:  &now,
			Traceparent:    input.Traceparent,
		}
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if !created {
		return task, false, nil
	}
	if err := PublishAsyncTaskByID(task.ID); err != nil {
		return task, true, err
	}
	if err := database.DB.First(task, task.ID).Error; err != nil {
		return nil, true, err
	}
	return task, true, nil
}

func PublishAsyncTaskByID(taskID uint) error {
	var task models.AsyncTask
	if err := database.DB.First(&task, taskID).Error; err != nil {
		return err
	}

	payload, err := parseTaskPayload(task.Payload)
	if err != nil {
		return err
	}
	values := buildAsyncTaskEnvelope(&task, payload)

	if err := PushTask(task.StreamName, values); err != nil {
		next := time.Now().UTC().Add(asyncTaskRetryDelay(task.AttemptCount + 1))
		updates := map[string]interface{}{
			"status":          AsyncTaskStatusRetryScheduled,
			"next_attempt_at": &next,
			"last_error":      fmt.Sprintf("publish failed: %v", err),
		}
		if updateErr := database.DB.Model(&task).Updates(updates).Error; updateErr != nil {
			log.Printf("failed to persist async task publish failure for task %d: %v", task.ID, updateErr)
		}
		return err
	}

	updates := map[string]interface{}{
		"status":          AsyncTaskStatusPending,
		"next_attempt_at": nil,
	}
	if err := database.DB.Model(&task).Updates(updates).Error; err != nil {
		return err
	}
	return nil
}

func EnqueueImageProcessingTask(photoID uint, minioPath, traceparent string) (*models.AsyncTask, error) {
	task, _, err := enqueueAsyncTask(EnqueueAsyncTaskInput{
		TaskType:       "image_processing",
		StreamName:     "image_processing_queue",
		ResourceType:   "photo",
		ResourceID:     photoID,
		IdempotencyKey: fmt.Sprintf("image-processing:%d", photoID),
		Payload: map[string]interface{}{
			"photo_id":   photoID,
			"minio_path": minioPath,
		},
		MaxAttempts: 5,
		Traceparent: traceparent,
	})
	return task, err
}

func EnqueueAIAnalysisTask(photoID uint, minioPath, provider, baseURL, apiKey, modelName, promptLanguage, traceparent string) (*models.AsyncTask, error) {
	task, _, err := enqueueAsyncTask(EnqueueAsyncTaskInput{
		TaskType:       "ai_analysis",
		StreamName:     "ai_analysis_queue",
		ResourceType:   "photo",
		ResourceID:     photoID,
		IdempotencyKey: fmt.Sprintf("ai-analysis:%d:%d", photoID, time.Now().UTC().UnixNano()),
		Payload: map[string]interface{}{
			"photo_id":        photoID,
			"minio_path":      minioPath,
			"provider":        provider,
			"base_url":        baseURL,
			"api_key":         apiKey,
			"model_name":      modelName,
			"prompt_language": promptLanguage,
		},
		MaxAttempts: 3,
		Traceparent: traceparent,
	})
	return task, err
}

func EnqueueInferParamsTask(photoID uint, minioPath, provider, baseURL, apiKey, modelName, promptLanguage, traceparent string) (*models.AsyncTask, error) {
	task, _, err := enqueueAsyncTask(EnqueueAsyncTaskInput{
		TaskType:       "infer_params",
		StreamName:     "infer_params_queue",
		ResourceType:   "photo",
		ResourceID:     photoID,
		IdempotencyKey: fmt.Sprintf("infer-params:%d:%d", photoID, time.Now().UTC().UnixNano()),
		Payload: map[string]interface{}{
			"photo_id":        photoID,
			"minio_path":      minioPath,
			"provider":        provider,
			"base_url":        baseURL,
			"api_key":         apiKey,
			"model_name":      modelName,
			"prompt_language": promptLanguage,
		},
		MaxAttempts: 3,
		Traceparent: traceparent,
	})
	return task, err
}

func EnqueueAutoTagTask(photoID uint, minioPath, traceparent string) (*models.AsyncTask, error) {
	task, _, err := enqueueAsyncTask(EnqueueAsyncTaskInput{
		TaskType:       "auto_tag",
		StreamName:     "auto_tag_queue",
		ResourceType:   "photo",
		ResourceID:     photoID,
		IdempotencyKey: fmt.Sprintf("auto-tag:%d:%d", photoID, time.Now().UTC().UnixNano()),
		Payload: map[string]interface{}{
			"photo_id":   photoID,
			"minio_path": minioPath,
		},
		MaxAttempts: 3,
		Traceparent: traceparent,
	})
	return task, err
}

func EnqueueExportTask(jobID uint, photoID uint, optsJSON, traceparent string) (*models.AsyncTask, error) {
	task, _, err := enqueueAsyncTask(EnqueueAsyncTaskInput{
		TaskType:       "export_photo",
		StreamName:     "export_queue",
		ResourceType:   "export_job",
		ResourceID:     jobID,
		IdempotencyKey: fmt.Sprintf("export-job:%d", jobID),
		Payload: map[string]interface{}{
			"job_id":         jobID,
			"photo_id":       photoID,
			"export_options": optsJSON,
		},
		MaxAttempts: 5,
		Traceparent: traceparent,
	})
	return task, err
}

func EnqueueAlbumExportTask(jobID uint, albumID uint, optsJSON, traceparent string) (*models.AsyncTask, error) {
	task, _, err := enqueueAsyncTask(EnqueueAsyncTaskInput{
		TaskType:       "export_album",
		StreamName:     "export_queue",
		ResourceType:   "export_job",
		ResourceID:     jobID,
		IdempotencyKey: fmt.Sprintf("album-export-job:%d", jobID),
		Payload: map[string]interface{}{
			"job_id":         jobID,
			"album_id":       albumID,
			"type":           "album_export",
			"export_options": optsJSON,
		},
		MaxAttempts: 5,
		Traceparent: traceparent,
	})
	return task, err
}

func EnqueueBackupTask(jobID uint, userID uint, traceparent string) (*models.AsyncTask, error) {
	task, _, err := enqueueAsyncTask(EnqueueAsyncTaskInput{
		TaskType:       "backup_export",
		StreamName:     "backup_queue",
		ResourceType:   "backup_job",
		ResourceID:     jobID,
		IdempotencyKey: fmt.Sprintf("backup-job:%d", jobID),
		Payload: map[string]interface{}{
			"job_id":  jobID,
			"user_id": userID,
			"type":    "backup_export",
		},
		MaxAttempts: 5,
		Traceparent: traceparent,
	})
	return task, err
}

func StartAsyncTask(taskID uint, workerID string) (*models.AsyncTask, error) {
	now := time.Now().UTC()
	leaseExpires := now.Add(asyncTaskLeaseDuration())
	task := &models.AsyncTask{}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(task, taskID).Error; err != nil {
			return err
		}
		switch task.Status {
		case AsyncTaskStatusCompleted, AsyncTaskStatusCancelled, AsyncTaskStatusDeadLetter:
			return ErrAsyncTaskNotRunnable
		case AsyncTaskStatusProcessing:
			return ErrAsyncTaskAlreadyActive
		case AsyncTaskStatusPending, AsyncTaskStatusRetryScheduled:
			task.Status = AsyncTaskStatusProcessing
			task.AttemptCount++
			task.WorkerID = workerID
			task.LeaseExpiresAt = &leaseExpires
			task.LastHeartbeatAt = &now
			task.NextAttemptAt = nil
			return tx.Save(task).Error
		default:
			return ErrAsyncTaskNotRunnable
		}
	})
	if err != nil {
		return nil, err
	}
	return task, nil
}

func HeartbeatAsyncTask(taskID uint, workerID string) (*models.AsyncTask, error) {
	now := time.Now().UTC()
	leaseExpires := now.Add(asyncTaskLeaseDuration())
	task := &models.AsyncTask{}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(task, taskID).Error; err != nil {
			return err
		}
		if task.Status != AsyncTaskStatusProcessing {
			return ErrAsyncTaskNotRunnable
		}
		if task.WorkerID != "" && workerID != "" && task.WorkerID != workerID {
			return ErrAsyncTaskAlreadyActive
		}
		task.WorkerID = workerID
		task.LastHeartbeatAt = &now
		task.LeaseExpiresAt = &leaseExpires
		return tx.Save(task).Error
	})
	if err != nil {
		return nil, err
	}
	return task, nil
}

func SucceedAsyncTask(taskID uint, workerID string) (*models.AsyncTask, error) {
	now := time.Now().UTC()
	task := &models.AsyncTask{}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(task, taskID).Error; err != nil {
			return err
		}
		if task.Status == AsyncTaskStatusCompleted {
			return nil
		}
		if task.Status != AsyncTaskStatusProcessing {
			return ErrAsyncTaskNotRunnable
		}
		if task.WorkerID != "" && workerID != "" && task.WorkerID != workerID {
			return ErrAsyncTaskAlreadyActive
		}
		updates := map[string]interface{}{
			"status":            AsyncTaskStatusCompleted,
			"completed_at":      &now,
			"lease_expires_at":  nil,
			"last_heartbeat_at": &now,
			"worker_id":         workerID,
			"next_attempt_at":   nil,
			"last_error":        "",
		}
		return tx.Model(task).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	if err := database.DB.First(task, taskID).Error; err != nil {
		return nil, err
	}
	return task, nil
}

func FailAsyncTask(taskID uint, workerID, errorMessage string) (*models.AsyncTask, error) {
	now := time.Now().UTC()
	task := &models.AsyncTask{}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(task, taskID).Error; err != nil {
			return err
		}
		if task.Status == AsyncTaskStatusCompleted || task.Status == AsyncTaskStatusDeadLetter || task.Status == AsyncTaskStatusCancelled {
			return nil
		}
		if task.Status != AsyncTaskStatusProcessing {
			return ErrAsyncTaskNotRunnable
		}
		if task.WorkerID != "" && workerID != "" && task.WorkerID != workerID {
			return ErrAsyncTaskAlreadyActive
		}

		updates := map[string]interface{}{
			"lease_expires_at":  nil,
			"last_heartbeat_at": &now,
			"worker_id":         workerID,
			"last_error":        errorMessage,
		}
		if task.AttemptCount < task.MaxAttempts {
			next := now.Add(asyncTaskRetryDelay(task.AttemptCount))
			updates["status"] = AsyncTaskStatusRetryScheduled
			updates["next_attempt_at"] = &next
			updates["completed_at"] = nil
		} else {
			updates["status"] = AsyncTaskStatusDeadLetter
			updates["completed_at"] = &now
			updates["next_attempt_at"] = nil
		}
		return tx.Model(task).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	if err := database.DB.First(task, taskID).Error; err != nil {
		return nil, err
	}
	return task, nil
}

func RetryAsyncTask(taskID uint) (*models.AsyncTask, error) {
	now := time.Now().UTC()
	task := &models.AsyncTask{}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(task, taskID).Error; err != nil {
			return err
		}
		if task.Status != AsyncTaskStatusDeadLetter && task.Status != AsyncTaskStatusCancelled {
			return ErrAsyncTaskNotRunnable
		}
		updates := map[string]interface{}{
			"status":            AsyncTaskStatusRetryScheduled,
			"attempt_count":     0,
			"next_attempt_at":   &now,
			"lease_expires_at":  nil,
			"last_heartbeat_at": nil,
			"worker_id":         "",
			"completed_at":      nil,
			"last_error":        "",
		}
		return tx.Model(task).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	if err := PublishAsyncTaskByID(taskID); err != nil {
		return task, err
	}
	if err := database.DB.First(task, taskID).Error; err != nil {
		return nil, err
	}
	return task, nil
}

func PublishDueAsyncTasks(limit int) (int, error) {
	if limit <= 0 {
		limit = 25
	}
	now := time.Now().UTC()
	var tasks []models.AsyncTask
	if err := database.DB.Where("status = ? AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?", AsyncTaskStatusRetryScheduled, now).
		Order("next_attempt_at asc").Limit(limit).Find(&tasks).Error; err != nil {
		return 0, err
	}
	published := 0
	for _, task := range tasks {
		if err := PublishAsyncTaskByID(task.ID); err != nil {
			log.Printf("failed to republish async task %d: %v", task.ID, err)
			continue
		}
		published++
	}
	return published, nil
}

func ReclaimExpiredAsyncTasks(limit int) (int, error) {
	if limit <= 0 {
		limit = 25
	}
	now := time.Now().UTC()
	var tasks []models.AsyncTask
	if err := database.DB.Where("status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?", AsyncTaskStatusProcessing, now).
		Order("lease_expires_at asc").Limit(limit).Find(&tasks).Error; err != nil {
		return 0, err
	}
	if len(tasks) == 0 {
		return 0, nil
	}

	ids := make([]uint, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	if err := database.DB.Model(&models.AsyncTask{}).
		Where("id IN ?", ids).
		Updates(map[string]interface{}{
			"status":            AsyncTaskStatusRetryScheduled,
			"next_attempt_at":   &now,
			"lease_expires_at":  nil,
			"last_heartbeat_at": &now,
			"worker_id":         "",
			"last_error":        "worker lease expired before task completion",
		}).Error; err != nil {
		return 0, err
	}
	return len(ids), nil
}
