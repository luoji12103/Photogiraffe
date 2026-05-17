# Phase 14 — 高级导出：相册 ZIP + PDF + 打印规格裁切

> 日期：2026-02-25
> 前置：Phase 13 全部完成，集成测试 129/129

## 目标

为 Photogiraffe 增加「批量相册导出」能力：
- **ZIP 批量导出**：将相册内所有照片打包下载
- **PDF 相册**：生成可分享的 PDF 相册文件（每页一张照片，含标题/EXIF 信息）
- **打印规格裁切**：支持 4×6、5×7、A4 等标准打印规格的中心裁切预处理

## Sub-versions

### v14.1 — Go Core 相册导出 API

- 新增 `ExportJob` 扩展字段（或复用现有 `ExportJob` 的 `export_options`）支持 `type: album`
- 新增 `POST /api/albums/:id/export`（JWT，同属）请求体：
  ```json
  { "format": "zip|pdf", "quality": 85, "print_spec": "none|4x6|5x7|a4" }
  ```
  - 创建 `ExportJob` 记录（status=pending），推送消息到 Redis Stream `photogiraffe_export_tasks`，消息 type=`album_export`
  - 返回 `{ "job_id": "..." }`
- 新增 `GET /api/albums/:id/exports`（JWT，同属）：返回该相册的导出任务列表
- Next.js 代理路由：`/api/albums/[id]/export/route.ts` 和 `/api/albums/[id]/exports/route.ts`

### v14.2 — Python Worker ZIP 相册导出

在 `python-worker/main.py` 的任务分派逻辑（`process_export_task` 入口）：
- 识别 `type=album_export`，调用新函数 `process_album_export(minio_client, job_id, album_id, opts)`
- 流程：
  1. `GET /internal/albums/{album_id}/photos` 获取相册照片列表（内部端点，需新增）
  2. 按导出选项对每张照片重新调用 Pillow resize/质量处理
  3. 打印规格裁切（若 `print_spec != "none"`）
  4. `zipfile.ZipFile` 打包到 `BytesIO`
  5. 上传到 MinIO `exports/album-{album_id}-{job_id}.zip`
  6. 回调 `/internal/exports/{job_id}/status` 标记 completed + output_path

### v14.3 — Python Worker PDF 相册生成

- 在 `requirements.txt` 添加 `fpdf2`
- `process_album_export_pdf()` 函数：
  1. 获取照片列表，按相册顺序排列
  2. `FPDF` A4 页面，每张照片一页
  3. 页眉：照片文件名；页脚：EXIF 摘要（相机/快门/ISO）+ Copyright（若有）
  4. 封面页：相册名称 + 照片数量
  5. 上传到 MinIO `exports/album-{album_id}-{job_id}.pdf`

### v14.4 — 打印规格裁切

在现有单张导出和相册导出中共用的辅助函数 `_crop_print_spec(img, spec)`：

| spec | 比例 | 说明 |
|------|------|------|
| `4x6` | 2:3 | 标准相纸 |
| `5x7` | 5:7 | 大尺寸相纸 |
| `a4`  | 1:√2 ≈ 1:1.414 | A4 打印 |
| `square` | 1:1 | 正方形裁切 |

- 中心裁切（保留最大可能面积）
- 集成到单张 `process_export_task()` 的 resize 之前（`export_options` 新增 `print_spec` 字段）
- 集成到 `process_album_export()`

### v14.5 — 前端导出 UI

- 相册详情页 `albums/[id]/page.tsx`：新增「导出相册」下拉按钮
  - 选项：格式（ZIP / PDF）、质量滑块、打印规格
  - 提交后轮询任务状态（同现有单张导出的 polling 逻辑）
  - 完成后显示下载按钮（复用 `/api/exports/:job_id/download`）
- `ExportPanel.tsx`：新增打印规格下拉选项（`print_spec: none|4x6|5x7|a4|square`）

### v14.6 — 构建 + 测试 + 提交

- Go Core `go build ./...` 无报错
- `python3 tests/integration_test.py` → **129/129**（不新增 Phase 14 专属测试，已有测试保持通过）
- `git commit`

## 约束

- ZIP/PDF 文件存储在 MinIO `exports/` 前缀下，与单张导出共享桶
- 相册内最多 200 张照片参与单次批量导出（限流保护）
- `fpdf2` 仅在 Python worker 容器中安装，前端无依赖
- 复用 `ExportJob` 模型，type 区分靠 `export_options.type` 字段
- 所有内部接口仍使用 `X-Internal-Secret`
