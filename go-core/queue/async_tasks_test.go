package queue

import (
	"testing"
	"time"

	"photogiraffe/core/models"
)

func TestAsyncTaskRetryDelayCaps(t *testing.T) {
	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{attempt: 1, want: 15 * time.Second},
		{attempt: 2, want: 30 * time.Second},
		{attempt: 3, want: 60 * time.Second},
		{attempt: 6, want: 8 * time.Minute},
		{attempt: 8, want: 15 * time.Minute},
	}

	for _, tc := range tests {
		if got := asyncTaskRetryDelay(tc.attempt); got != tc.want {
			t.Fatalf("attempt %d: got %s want %s", tc.attempt, got, tc.want)
		}
	}
}

func TestBuildAsyncTaskEnvelopePreservesPayloadAndMetadata(t *testing.T) {
	task := &models.AsyncTask{
		TaskType:     "export_photo",
		MaxAttempts:  5,
		AttemptCount: 2,
		Traceparent:  "00-test-trace",
	}
	payload := map[string]interface{}{
		"job_id":   uint(42),
		"photo_id": uint(7),
	}

	envelope := buildAsyncTaskEnvelope(task, payload)

	if envelope["job_id"] != uint(42) {
		t.Fatalf("expected job_id in envelope, got %#v", envelope["job_id"])
	}
	if envelope["photo_id"] != uint(7) {
		t.Fatalf("expected photo_id in envelope, got %#v", envelope["photo_id"])
	}
	if envelope["task_type"] != "export_photo" {
		t.Fatalf("expected task_type metadata, got %#v", envelope["task_type"])
	}
	if envelope["attempt"] != 3 {
		t.Fatalf("expected next attempt number 3, got %#v", envelope["attempt"])
	}
	if envelope["max_attempts"] != 5 {
		t.Fatalf("expected max_attempts metadata, got %#v", envelope["max_attempts"])
	}
	if envelope["traceparent"] != "00-test-trace" {
		t.Fatalf("expected traceparent metadata, got %#v", envelope["traceparent"])
	}
}
