# Phase 8 Roadmap — Dashboard, AI 降噪、高级搜索与 PWA

> 编写日期：2026-02-24
> 状态：In Progress
> 前序：Phase 7 全部完成（v7.1–v7.5，最新 commit `e3ddf12`）

---

## 背景

Phase 7 实现了摄影师身份、相册组织、GPS 地图、对比视图和增强预设。
Phase 8 聚焦**运营视角、AI 图像处理、内容发现与跨平台能力**，完成 InitialThoughts 中尚未实现的两个核心要求：

| InitialThoughts 条目 | 当前状态 | Phase 8 目标 |
|--------------------|---------|------------|
| 条目8：AI 降噪（AI denoising）| 未实现 | v8.2 |
| 条目2：预留 Android/Windows 原生接口 | 无文档 | v8.4 PWA（渐进增强） |
| 数据总览 / 运营视角 | 无 Dashboard | v8.1 |
| 按 EXIF 维度搜索 | 全文搜索有限 | v8.3 |
| 背景任务状态反馈 | 需手动刷新 | v8.5 SSE 实时通知 |

---

## 子版本列表

| 版本 | 方向 | 描述 |
|------|------|------|
| v8.1 | Dashboard & 统计 | 照片数量/存储/AI 分析/相册等核心指标卡片；七日上传趋势图；按相机/镜头/位置分布 |
| v8.2 | AI 降噪（Export 选项） | Python Worker 新增 `denoise` 处理步骤；导出面板新增降噪级别选项；Go Core 透传参数 |
| v8.3 | 高级搜索 | Go Core 新增 `GET /api/photos/search` 支持相机型号/焦段/ISO/日期范围/GPS 范围过滤；前端新建搜索页 |
| v8.4 | PWA 支持 | Next.js 添加 `manifest.json`、`sw.js`（缓存图片 thumbnail）、icon 集合；Android/desktop installable |
| v8.5 | SSE 实时通知 | Go Core 新增 `GET /api/events/stream` SSE 端点；前端 useSSE hook；导出/AI 任务完成时推送 toast |

---

## API 变更汇总

### v8.1 (Dashboard)
- `GET /api/stats` → 返回：
  ```json
  {
    "total_photos": 142,
    "storage_used_mb": 3812,
    "ai_analyzed": 97,
    "albums": 5,
    "presets": 12,
    "recent_uploads": [{"date": "2026-02-24", "count": 4}, ...],
    "cameras": [{"name": "Sony A7R V", "count": 38}, ...],
    "lens": [...],
    "top_locations": [{"city": "Paris", "count": 12}, ...]
  }
  ```

### v8.2 (AI Denoising)
- `POST /api/export` 请求体新增 `denoise_level: 0|1|2|3`（0=不降噪, 1=轻, 2=中, 3=强）
- Python Worker `process_export_task` 中，在最终 resize/compress 之前用 `cv2.fastNlMeansDenoisingColored` 处理（h 参数：0→0, 1→5, 2→10, 3→20）

### v8.3 (Advanced Search)
- `GET /api/photos/search?camera=Sony%20A7RV&lens=85mm&iso_min=100&iso_max=800&date_from=2026-01-01&date_to=2026-02-24&lat=48.85&lng=2.35&radius_km=50&q=paris`
- 返回与画廊相同的 Photo 结构（含 EXIF 关联），支持分页 `page/limit`

### v8.4 (PWA)
- `GET /manifest.json` (Next.js static)
- 无新后端 API

### v8.5 (SSE Notifications)
- `GET /api/events/stream` — SSE，需 JWT 验证，持久连接
- 后端：Go Core 内存维护 `userID → chan SSEEvent` 映射，导出/AI/infer 任务回调时广播
- 事件格式：`data: {"type": "export_done", "job_id": "xxx", "download_url": "..."}\n\n`

---

## 数据库变更

- **无新表**（v8.1 统计查询使用 COUNT/SUM + JOIN，不创建额外表）
- `export_options` JSON 字段新增 `denoise_level` 值（向后兼容，缺省=0）

---

## 依赖关系

```
v8.1（独立，纯统计查询）
v8.2（export 扩展，需要 Python Worker 和 OpenCV 已安装 → requirements.txt 已有 opencv-python-headless）
v8.3（独立，EXIF 关联查询）
v8.4（纯前端，独立）
v8.5（影响 Go Core + 前端，独立实现后 v8.2/v8.3 可接入）
```

---

## 实施顺序

按影响面从小到大：  
**v8.3 → v8.1 → v8.4 → v8.5 → v8.2**

- v8.3 只增 API + 前端页，风险低
- v8.1 只读统计，无写操作
- v8.4 纯静态文件
- v8.5 需要改 Go Core 并发模型，影响较大但不破坏已有接口
- v8.2 涉及 Python Worker 修改，放最后保证其他功能先稳定
