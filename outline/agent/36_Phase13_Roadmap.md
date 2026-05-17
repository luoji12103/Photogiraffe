# Phase 13 — IPTC/XMP 元数据写入

> 日期：2026-02-25
> 前置：Phase 12 全部完成，集成测试 129/129

## 目标

实现完整的版权元数据生命周期：
- **上传时**：自动提取照片中内嵌的 XMP（`dc:rights` / `dc:creator`）存入数据库
- **导出时**：将 Copyright + Creator 写入 JPEG IFD0 EXIF 标签（piexif）
- **前端**：提供 IPTC 编辑面板，随时修改版权信息

## Sub-versions

### v13.1 — Go Core 数据模型 + IPTC API

- `models/models.go`：`ExifData` 结构体新增 `Copyright string` 和 `Creator string` 字段（GORM AutoMigrate 自动建列）
- 新增 `GET /api/photos/:id/iptc`（JWT，仅同属用户/SuperAdmin 可读）
- 新增 `PUT /api/photos/:id/iptc`（JWT，仅同属用户可写）
- 新增 `GET /internal/photos/:id/iptc`（requireInternalSecret，供 Python worker 无鉴权访问）
- Next.js 代理路由：`frontend/src/app/api/photos/[id]/iptc/route.ts`（GET + PUT 转发）

### v13.2 — Python Worker 上传管道 XMP 提取

在 `process_image()` 中，EXIF 提取完成后：
- 正则扫描 `<x:xmpmeta>` XMP 包
- 提取 `dc:rights` → `Copyright`，`dc:creator` → `Creator`
- 均注入 `exif_data` dict，随状态回调发送至 Go Core `/internal/photos/:id/status`

### v13.3 — Python Worker 导出管道 IPTC 写入

在 `process_export_task()` 的 piexif 注入区：
- 调用 `GET /internal/photos/:id/iptc` 获取 copyright、creator、description
- 注入 piexif IFD0：`Copyright → ImageIFD.Copyright`，`Creator → ImageIFD.Artist`，`Description → ImageIFD.ImageDescription`
- 即使原始 EXIF 字节缺失也会创建空 exif_dict 并写入

### v13.4 — 前端 IPTCPanel 组件

- 创建 `frontend/src/components/IPTCPanel.tsx`
  - 组件挂载时自动拉取现有 copyright/creator
  - 双输入框 + Save 按钮，使用 pg-* token 设计语言
  - 保存成功后 3s 消散的绿色 CheckCircle 提示
- 集成至 `PhotoDetail.tsx`：editMode 区块的 ExportPanel 之后显示

### v13.5 — 构建 + 测试 + 提交

- `go build ./...` 无报错
- `python3 tests/integration_test.py` → **129/129**
- `git commit`

## 约束

- Worker 调用 IPTC 接口使用内部端点（X-Internal-Secret），不走 JWT
- 前端 IPTCPanel 仅在 editMode（照片所有者）下渲染
- 不修改现有集成测试，保持 129/129
