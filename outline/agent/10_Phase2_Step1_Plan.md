# Phase 2 Step 1: 深度 EXIF 解析与元数据引擎 (Python + Go)

## 目标
在图片处理阶段，提取专业的摄影参数（相机、镜头、光圈、快门、ISO、焦距、GPS、ICC Profile），并将这些元数据持久化到 PostgreSQL，与照片记录关联。

## 预计修改方向
1. **Go Core API 增强**:
   - 在 `go-core/models/models.go` 中，更新 `ExifData` 结构体，增加 `GPSLatitude`, `GPSLongitude`, `Software`, `DateTimeOriginal` 等字段。
   - 在 `go-core/main.go` 中，更新 `/internal/photos/:id/status` 接口，使其能够接收 JSON payload 中的 `exif_data` 对象，并将其保存到数据库中。
2. **Python Worker 增强**:
   - 在 `python-worker/requirements.txt` 中添加 `exifread` 库，用于更稳健地提取 RAW/HEIF/JPEG 的 EXIF 信息。
   - 在 `python-worker/main.py` 中，在处理图片时，使用 `exifread` 和 `Pillow` 提取 EXIF 数据和 ICC Profile。
   - 将提取到的数据格式化为 Go API 期望的 JSON 结构，并在更新状态时一并发送给 Go Core API。

## 预期结果
上传一张包含 EXIF 信息的照片后，Python Worker 能够成功提取出相机型号、光圈、快门等信息，并通过内部 API 发送给 Go Core。Go Core 将这些信息存入 `exif_data` 表中。可以通过查询数据库或后续的 API 接口验证数据是否正确保存。
