# Phase 2 Completion — 上传 UI（拖拽上传面板）

## 背景

Phase 2 的 Steps 1–4 已全部完成（EXIF 提取、沉浸式详情页、AI 配置、多 Provider AI 分析），Security Hardening（v2.3）和一轮全面 Bug 修复（v2.3_debug）也已完成。

**当前遗漏**：photos 目前只能通过 `curl -X POST /upload` 上传，前端无任何上传界面，属于 Phase 2 Step 2 计划中提到但未实现的功能，是 Phase 2 的最后补全。

## 目标

在画廊主页为用户提供可视化、交互友好的本地文件上传功能：
- 支持拖拽（Drag & Drop）或点击选择文件
- 支持批量多文件同时上传
- 每个文件独立显示上传进度（%）和最终状态（成功/失败）
- 上传成功后自动刷新画廊
- 不将 `ADMIN_TOKEN` 暴露给浏览器（通过 Next.js 服务端代理路由转发）

## 支持的文件类型

| 格式 | 说明 |
|------|------|
| `.jpg` `.jpeg` | JPEG（修图后导出） |
| `.png` | PNG |
| `.webp` | WebP |
| `.heif` `.heic` `.hif` | HEIF（Sony / iOS 原始格式） |
| `.arw` | Sony RAW |
| `.cr2` `.cr3` | Canon RAW |
| `.nef` | Nikon RAW |
| `.dng` | Adobe DNG |
| `.raf` | Fujifilm RAW |
| `.tiff` `.tif` | TIFF |

## 预计修改方向

### 1. 新增 API 代理路由 `frontend/src/app/api/upload/route.ts`
- 接受 `POST multipart/form-data`
- 从 `process.env.ADMIN_TOKEN` 读取 Token
- 使用 `fetch` 将 FormData 原样转发到 `${INTERNAL_API_URL}/upload`（附 `Authorization: Bearer <token>`）
- 返回 go-core 的原始 JSON 响应和 HTTP 状态码
- 不在客户端侧暴露 Token

### 2. 新增组件 `frontend/src/components/UploadPanel.tsx`（`"use client"`）
- 整体为一个**可折叠面板**（expanded/collapsed state）
- 收起状态：显示一个紧凑的 **"Upload"** 按钮（在 header 右侧，与 Settings 并列）
- 展开状态：在 header 下方滑出一个上传面板，包含：
  - 拖拽区域（虚线边框，悬停变色），文案提示支持格式
  - 点击拖拽区域触发 `<input type="file" multiple accept="...">` 文件选择
  - 文件列表（每个文件显示：文件名、大小、进度条、状态图标）
  - 上传进度使用 `XMLHttpRequest` 获取 `progress` 事件（fetch 不支持上传进度）
  - 全部完成后显示 "Done" 按钮，点击调用 `router.refresh()` 刷新画廊，并折叠面板
  - 右上角 "×" 按钮可随时关闭面板（提示有文件仍在上传时弱提示但不阻止）

#### 文件状态机
```
pending → uploading (0–100%) → done ✅
                              → error ❌ (显示错误消息)
```

### 3. 修改 `frontend/src/app/page.tsx`
- 将 header 区域的 `<Link href="/settings">` 旁边增加 `<UploadPanel />` 组件
- `page.tsx` 保持服务端组件（SSC），不引入 `"use client"`
- `UploadPanel` 是客户端组件，自行管理打开/关闭状态

## 技术细节

### 为何使用 XHR 而非 fetch
`fetch` API 不支持上传进度事件（`onprogress`）。对于可能高达 100MB 的 RAW 文件，无进度反馈体验极差。XHR 的 `xhr.upload.onprogress` 可以提供准确的字节级进度。

### 并发策略
一次选择多个文件时，按顺序逐个上传（不并发），避免在 go-core 和 MinIO 之间产生并发写入竞争，同时使每个文件的进度条可独立显示。

### 刷新策略
使用 Next.js App Router 的 `router.refresh()`，它触发服务端重新 fetch 数据而不做完整页面导航，画廊内容无缝更新。

## 预期效果

用户在画廊主页点击 "Upload" 按钮 → 面板展开 → 拖入或选择 RAW/JPEG/HEIF 文件 → 实时看到每张文件的上传进度 → 上传完成 → 点击 "Done" → 画廊自动刷新显示新照片（状态为 "Processing..."，Python Worker 异步处理完后变为缩略图）。

## 不在本次范围内
- 上传时的服务端流式进度（仅客户端 XHR 进度）
- 断点续传
- 重复文件检测（哈希去重）
- S5 Redis API Key 明文问题（低优先级，保留在 roadmap）
