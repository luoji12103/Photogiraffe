# Task 7 Evidence: Upload → Queue → Worker → Status Lifecycle (Deep)

## Execution Window
- Start: `2026-03-14T06:19:25.300611Z`
- End (status completed observed): `2026-03-14T06:19:26.005Z`

## Scope
Verified full pipeline for one test photo:
1. Upload API accepted file
2. Redis Stream task published (`image_processing_queue`)
3. Python worker consumed and processed
4. Worker callback updated Go Core photo status
5. Thumbnail/proxy generated in MinIO
6. Final status observed as `completed`

---

## 1) Upload Test Photo via API

### Command/Evidence
- Login + upload performed against `http://localhost:8080`
- Upload response:

```json
{
  "message": "Image uploaded successfully and queued for processing",
  "path": "raw/f05dafea-7f26-4d29-9fd7-791eda79fc05.jpg",
  "photo_id": 21
}
```

### Timestamps
- Upload request accepted at: `2026-03-14T06:19:25.857645Z`
- Go Core log:
  - `2026-03-14T06:19:25.851325398Z Successfully uploaded raw/f05dafea-7f26-4d29-9fd7-791eda79fc05.jpg of size 821`

---

## 2) Redis Stream Publish Verification

### Stream metadata
- Stream: `image_processing_queue`
- Latest entry ID: `1773469165855-0`
- Derived UTC from stream ID ms: `2026-03-14T06:19:25.855000Z`

### Stream payload (latest)
```text
1773469165855-0
photo_id
21
minio_path
raw/f05dafea-7f26-4d29-9fd7-791eda79fc05.jpg
```

### Publisher log
- `2026-03-14T06:19:25.856032567Z Successfully published task for PhotoID 21 to image_processing_queue`

---

## 3) Python Worker Consumption + Processing Verification

### Worker logs (timestamped)
```text
2026-03-14T06:19:25.856291516Z Received task from image_processing_queue: 1773469165855-0 -> {'photo_id': '21', 'minio_path': 'raw/f05dafea-7f26-4d29-9fd7-791eda79fc05.jpg'}
2026-03-14T06:19:25.856380238Z Downloading raw/f05dafea-7f26-4d29-9fd7-791eda79fc05.jpg from MinIO...
2026-03-14T06:19:25.859700599Z Processing image 21...
2026-03-14T06:19:25.955236666Z Uploading proxy to proxy/f05dafea-7f26-4d29-9fd7-791eda79fc05.webp...
2026-03-14T06:19:25.960405300Z Uploading thumbnail to thumb/f05dafea-7f26-4d29-9fd7-791eda79fc05.webp...
2026-03-14T06:19:25.964801684Z Updating status for photo 21 to completed...
2026-03-14T06:19:26.005343696Z [colors] photo 21 → ['purple']
2026-03-14T06:19:26.005385824Z Successfully processed photo 21
2026-03-14T06:19:26.005983701Z Acknowledged message 1773469165855-0
```

Result: ✅ worker consumed, processed, updated status, and ACKed stream message.

---

## 4) Go Core Status Update Callback Verification

Go route under test (read-only inspection):
- `PUT /internal/photos/:id/status` guarded by `X-Internal-Secret`

Observed state in API after processing:

```json
{
  "ID": 21,
  "MinioPath": "raw/f05dafea-7f26-4d29-9fd7-791eda79fc05.jpg",
  "Status": "completed",
  "CreatedAt": "2026-03-14T06:19:25.851444Z",
  "UpdatedAt": "2026-03-14T06:19:26.002575Z",
  "DominantColors": "[{\"hex\": \"#7851c8\", \"pct\": 100.0, \"bucket\": \"purple\"}]"
}
```

Result: ✅ callback path updated row to `completed`.

---

## 5) MinIO Artifact Verification (Raw + Proxy + Thumbnail)

Executed in MinIO container via `mc stat`:

```text
local/photos/raw/f05dafea-7f26-4d29-9fd7-791eda79fc05.jpg   Size: 821 B   Date: 2026-03-14 06:19:25 UTC
local/photos/proxy/f05dafea-7f26-4d29-9fd7-791eda79fc05.webp Size: 98 B   Date: 2026-03-14 06:19:25 UTC
local/photos/thumb/f05dafea-7f26-4d29-9fd7-791eda79fc05.webp Size: 98 B   Date: 2026-03-14 06:19:25 UTC
```

Result: ✅ generated objects present in expected locations.

---

## 6) End-to-End Lifecycle Verdict

### Required chain
- Upload → Redis queue → Python worker → Status update → Thumbnail generation

### Verification status
- Upload accepted: ✅
- Task published to Redis Stream: ✅
- Worker consumed and ACKed: ✅
- Internal status callback succeeded: ✅
- Thumbnail generated in MinIO: ✅
- Final status `completed`: ✅

## Notes
- Additional unrelated Go log noise observed (`login_history` relation missing), but it did **not** block this upload lifecycle.
