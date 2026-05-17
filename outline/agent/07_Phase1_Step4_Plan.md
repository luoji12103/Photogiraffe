```markdown
# Phase 1 Step 4: Python Worker 的图像处理与状态回调

## 目标
实现 Python Worker 的核心逻辑：监听 Redis Stream 中的图片处理任务，从 MinIO 下载原图，使用 Pillow/OpenCV 生成代理图和缩略图，将处理后的图片上传回 MinIO，并通过内部接口通知 Go Core API 更新数据库状态。

## 预计修改方向
1. **Go Core API 内部接口**:
   - 在 `go-core/main.go` 中添加 `PUT /internal/photos/:id/status` 接口，允许 Python Worker 更新照片的处理状态（如 `completed`, `failed`）。
2. **Python Worker 依赖**:
   - 更新 `python-worker/requirements.txt`，添加 `requests` 用于调用 Go API。
3. **Python Worker 核心逻辑**:
   - 修改 `python-worker/main.py`，实现 Redis Stream 的消费者组监听逻辑。
   - 接收到任务后，解析 `photo_id` 和 `minio_path`。
   - 从 MinIO 下载原图到本地临时目录。
   - 使用 `Pillow` 生成 WebP 格式的代理图（如长边 2048px）和缩略图（如长边 512px）。
   - 将生成的代理图和缩略图上传至 MinIO 的 `photos` bucket（如 `proxy/` 和 `thumb/` 目录）。
   - 调用 Go Core API 的内部接口，更新照片状态为 `completed`。
   - 确认（ACK）Redis Stream 中的消息。

## 预期结果
重启 `go-core` 和 `python-worker` 容器后，再次上传图片。Python Worker 能够自动接单并处理图片，MinIO 中会出现 `proxy/` 和 `thumb/` 目录下的新文件，PostgreSQL 中该照片的状态会变为 `completed`。
```