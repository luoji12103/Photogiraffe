# v4.0 高自由度无损导出引擎 — 实施计划

**日期**: 2026-02-22  
**基于**: 21_Phase4_Roadmap.md

---

## 改动范围

### 1. Go Core
**`go-core/models/models.go`**  
- 新增 `ExportJob` 结构体（含 `ExportOptions` jsonb 字段）

**`go-core/queue/redis.go`**  
- 新增 `PublishExportTask(jobID, photoID uint, optsJSON string)` 函数

**`go-core/main.go`**  
- `POST /api/photos/:id/export` — 创建 ExportJob、推入 Redis Stream
- `GET  /api/photos/:id/exports` — 列出导出历史
- `GET  /api/exports/:job_id` — 查询单个任务状态
- `GET  /api/exports/:job_id/download` — 生成 MinIO presigned URL（15 min）

### 2. Python Worker
**`python-worker/main.py`**  
- 新消费函数 `process_export_task(job_id, photo_id, opts)`
- 步骤：下载原图 → 解码（rawpy/Pillow）→ 应用调色参数（NumPy）→ 缩放（LANCZOS）→ 叠加水印 → 注入 EXIF → 上传 MinIO → 更新 status

### 3. 前端 (Next.js)
**`frontend/src/components/ExportPanel.tsx`**（新建）  
- 格式选择（JPEG/PNG/WebP/TIFF）、质量滑块、长边尺寸、水印开关
- 导出按钮 → `POST /api/photos/:id/export`
- 进度轮询（3s interval）→ 显示下载链接

**`frontend/src/components/PhotoDetail.tsx`**  
- 侧边栏新增 "Export" 折叠区块 + `<ExportPanel>`

**`frontend/src/app/api/photos/[id]/export/route.ts`**（新建）  
- Next.js API route，透传到 go-core 的 `/api/photos/:id/export`

**`frontend/src/app/api/exports/[job_id]/route.ts`**（新建）  
- 状态查询代理

**`frontend/src/app/api/exports/[job_id]/download/route.ts`**（新建）  
- 下载 URL 代理

---

## 数据流
```
前端 ExportPanel
    │ POST /api/photos/:id/export {format, quality, ...adjust_params}
    ▼
Next.js API route (代理) 
    │ → go-core POST /api/photos/:id/export
    ▼
Go Core: 创建 ExportJob (status=pending) → PublishExportTask → Redis Stream
    ▼
Python Worker: 消费 export_tasks stream
    │ 1. 下载原图 (MinIO)
    │ 2. 条件解码: rawpy (RAW) / pillow_heif (HEIF) / Pillow (JPEG/PNG)
    │ 3. NumPy 线性空间调色参数应用
    │ 4. Pillow LANCZOS 缩放
    │ 5. 水印叠加 (Alpha 合成)
    │ 6. piexif 注入 EXIF
    │ 7. 上传到 MinIO "export/{job_id}.{ext}"
    │ 8. PUT /internal/exports/:job_id/status {status: completed, output_path: ...}
    ▼
前端轮询 GET /api/exports/:job_id → 显示下载链接
    │ GET /api/exports/:job_id/download → MinIO presigned URL (15min)
```

---

## ExportJob DB Schema
```go
type ExportJob struct {
    gorm.Model
    PhotoID       uint
    UserID        uint
    Status        string  // pending | processing | completed | failed
    ExportOptions string  `gorm:"type:jsonb"` // serialized ExportOptions
    OutputPath    string  // MinIO path when completed
    ErrorMessage  string  // if failed
    CompletedAt   *time.Time
}
```

---

## 风险控制
- 最大输出尺寸限制 8000×8000px，防止 OOM
- Python Worker 同一时间最多并行 2 个 export 任务（通过 goroutine 数量配置 Redis XREAD COUNT）
- 水印路径不存在时静默跳过（不导致整个 export 失败）
