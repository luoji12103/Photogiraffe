# Phase 4 Roadmap — 导出引擎与预设管理

**日期**: 2026-02-22  
**分支**: s4.6full-stack  
**前序提交**: b3b8b04 (v3.3)

---

## 目标
提供高自由度的无损导出和预设分享功能，并探索 AI 辅助的修图参数反推能力。

---

## Step 1 — v4.0: 高自由度无损导出引擎

### 后端 (Go Core)
- 新 DB 模型 `ExportJob`：`photo_id`, `user_id`, `status`, `output_path`, `export_options (jsonb)`, `created_at`, `completed_at`
- 新 API 端点：
  - `POST /api/photos/:id/export` → 生成导出任务，写入 Redis 队列
  - `GET  /api/photos/:id/exports` → 列出该照片的导出历史
  - `GET  /api/exports/:job_id` → 查询单个导出任务状态
  - `GET  /api/exports/:job_id/download` → 从 MinIO 生成下载 presigned URL（限时 15 min）
- 新 queue 方法：`PublishExportTask(jobID, photoID uint, opts ExportOptions)`

### 队列 schema (`ExportOptions`)
```json
{
  "format":       "jpeg|png|webp|tiff",
  "quality":      85,
  "width":        0,
  "height":       0,
  "long_edge":    2048,
  "watermark_path": "presets/watermark.png",
  "watermark_opacity": 0.6,
  "watermark_position": "bottom_right",
  "embed_exif":   true,
  "adjust": {
    "exposure":   0.0,
    "brightness": 0.0,
    "contrast":   0.0,
    "saturation": 1.0,
    "tonemap":    false
  }
}
```

### Python Worker
- 新消费者函数 `process_export_task(job_id, photo_id, opts)`
- 从 MinIO 下载原图（RAW/HEIF → Pillow/rawpy）
- 应用调色参数（利用 NumPy 线性空间操作）
- 缩放（Pillow `LANCZOS`）
- 叠加 PNG 水印（带 Alpha 通道合成）
- 注入 EXIF（使用 `piexif`）
- 写出目标格式并上传到 MinIO `export/` 路径
- 通过内部 API 更新 `ExportJob.status = "completed"` 及 `output_path`

### 前端 (Next.js)
- `ExportPanel.tsx`：格式/质量/长边/水印选项面板（折叠 Accordion）
- `PhotoDetail.tsx`：侧边栏新增 "Export" 板块 + 导出按钮 + 进度轮询 + 下载链接

---

## Step 2 — v4.1: 预设管理

### 后端 (Go Core)
- 新 DB 模型 `Preset`：`user_id`, `name`, `description`, `file_path (MinIO)`, `thumbnail_path`, `adjust_params (jsonb)`, `created_at`
- 新 API 端点：
  - `POST /api/presets` (multipart) → 上传预设文件 + 元数据到 MinIO
  - `GET  /api/presets` → 列出所有预设
  - `GET  /api/presets/:id/download` → presigned URL
  - `DELETE /api/presets/:id` → 删除预设
  - `POST /api/photos/:id/apply-preset/:preset_id` → 将预设参数复制到图片的调色状态（前端状态，无持久化修改）

### Python Worker（可选扩展）
- 若上传 `.xmp` 或 `.lrtemplate` 文件，Python Worker 解析参数并提取 `adjust_params` 写回数据库

### 前端 (Next.js)
- `PresetPanel.tsx`：网格显示预设列表（缩略图 + 名称）
- 点击预设 → 更新 `adjustParams` state（即时应用到 GLCanvas）
- 上传自定义预设（仅存储 adjust_params JSON，不强制 .xmp 格式）

---

## Step 3 — v4.2: 修图参数反推（AI 视觉回归）

> **⚠️ 人类决策点**  
> 此步骤需要在"原图"与"成片"之间构建差异张量，训练/微调一个视觉回归模型来估算修图滑块参数。  
> 实施路径选择：  
> **Option A**: 直接调用多模态大模型（GPT-4o / Gemini），通过 prompt 让其估算调整参数（粗略但可用）  
> **Option B**: 训练小型 CNN 回归模型（需要带标注的成对数据集）  
> **推荐**: 先用 Option A（LLM prompt）快速实现可用版本，留接口供后续 Option B 替换。

### Option A 实现思路（当前版本）
- Python Worker 新功能：接收 `photo_id` + 当前 `adjust_params`
- 核心逻辑：截取图片的代表性区域 → Base64 → 调用多模态 LLM → parse 返回的 JSON 参数
- 结果写入 `photos.inferred_params (jsonb)` 字段
- 前端在 AdjustPanel 显示 "AI 建议" 按钮，点击后填充推断参数

---

## 执行顺序与依赖
```
v4.0 Export Engine  ──▶  v4.1 Preset Management  ──▶  v4.2 AI Parameter Inference
  (独立)                    (依赖 v4.0 MinIO pattern)    (依赖 v4.1 preset JSON schema + 人类决策)
```

## 技术风险
| 风险 | 缓解策略 |
|------|---------|
| rawpy + OpenCV 在 Alpine Docker 中的编译 | 使用 `python:3.11-slim` base image，预装 libraw-dev |
| Export 大文件（50MB+）导致 Python Worker OOM | 分块 streaming 写出，限制最大分辨率 |
| WebGL adjust params → Python 参数对齐 | 前端调用 export 时将 `adjustParams` 完整序列化进 `ExportOptions` |
| XMP 解析复杂性 | v4.1 仅支持 adjust_params JSON 上传，XMP 解析作为可选扩展 |
