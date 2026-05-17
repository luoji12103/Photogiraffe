# Phase 9 Roadmap — 水印导出、公开主页、批量操作与 UX 打磨

> 编写日期：2026-02-24
> 状态：In Progress
> 前序：Phase 8 全部完成（v8.1–v8.5，最新 commit `9331fbd`）

---

## 背景

Phase 8 完成了仪表盘、高级搜索、PWA、SSE 实时通知和 AI 降噪。
Phase 9 聚焦 **InitialThoughts 中最后几个显式要求**，以及整体 UX 打磨：

| InitialThoughts 条目 | Phase 9 目标 |
|--------------------|------------|
| 条目13：导出时叠加摄影师头像/签名（PNG 透明通道）/水印/参数文字/照片简介 | v9.1 水印导出 |
| 条目3：社交/分享平台扩展，公开主页 | v9.2 公开摄影师主页 |
| 条目8/13：批量操作（批量导出/批量加相册/批量删除） | v9.3 批量操作 |
| 条目6/9/12：照片详情增强（完整 EXIF 面板、AI 分析展示、关键词标签） | v9.4 照片详情增强 |
| 条目1：生产级前端美学与性能 | v9.5 UX 打磨与性能 |

---

## 子版本列表

| 版本 | 方向 | 核心内容 |
|------|------|---------|
| v9.1 | 水印与叠加导出 | Python Worker 叠加摄影师签名/头像（PNG Alpha）、EXIF 文本、照片描述；ExportPanel 新增水印选项 |
| v9.2 | 公开摄影师主页 | `/p/[username]` 公开作品集页（无需登录）；选择公开的照片；简介/社交链接展示 |
| v9.3 | 批量操作 | Gallery 多选模式；批量加入相册；批量导出（zip）；批量删除 |
| v9.4 | 照片详情增强 | 可折叠 EXIF 全字段面板；照片关键词标签（用户可编辑）；AI 分析结果结构化展示 |
| v9.5 | UX 打磨 | 虚拟滚动 Gallery；Skeleton loader；乐观更新；移动端触摸手势（双指缩放预览） |

---

## 实现顺序

```
v9.1 → v9.2 → v9.3 → v9.4 → v9.5
```

---

## v9.1 — 水印与叠加导出

### 后端（Python Worker）
`process_export_task` 最终 compose 阶段新增 overlay 步骤：

```python
# ExportOptions 新字段
overlay_signature: bool     # 叠加 signatures/{uid}/*.png
overlay_avatar: bool        # 叠加 profiles/avatars/{uid}/*.webp (圆形裁切)
overlay_exif: bool          # 在右下角渲染 EXIF 文字块
overlay_description: bool   # 在底部渲染照片描述
overlay_position: str       # "bottom-right" | "bottom-left" | "bottom-center" | "top-right"
overlay_opacity: float      # 0.3–1.0
```

叠加顺序：底→描述文字→EXIF文字→头像→签名

### 后端（Go Core）
`POST /api/export` ExportOptions 透传上述新字段（已有 `ExportOptions string jsonb`，纯需在前端传入 JSON）

返回新增辅助接口：
- `GET /api/profile/overlays` → 返回用户是否已上传 signature/avatar 路径（供前端激活水印选项）

### 前端（ExportPanel.tsx）
新增 "水印与叠加" 折叠区：  
- 开关：叠加签名 / 叠加头像 / 显示EXIF参数 / 显示照片描述  
- 滑块：透明度 30%–100%  
- 下拉：叠加位置  
- 预览：静态示意图（非实时渲染，仅文字说明）  

---

## v9.2 — 公开摄影师主页

### 后端（Go Core）
```
GET /p/:username            → 公开主页（无需 JWT）→ 返回 UserProfile + 公开照片列表
PUT /api/photos/:id/public  → 切换单张照片的 is_public 字段
GET /api/photos/public      → 当前用户已公开的照片列表
```

`Photo` 模型新增 `IsPublic bool gorm:"default:false"`

### 前端
- `/p/[username]` — 公开主页：摄影师头像/简介/网站/位置 + 作品网格（仅公开照片）
- 照片详情页的 "..." 菜单：切换"公开/私有"
- 个人主页侧边栏：我的公开链接 `/p/{username}` 快速入口

---

## v9.3 — 批量操作

### 后端（Go Core）
```
POST /api/photos/bulk-album     body: {photo_ids: [...], album_id: N}
DELETE /api/photos/bulk         body: {photo_ids: [...]}
POST  /api/export/bulk          body: {photo_ids: [...], options: ExportOptions} → 返回 zip 下载链接
```

Python Worker 新增 `photogiraffe_bulk_export_tasks` stream 处理

### 前端
- Gallery 右上角"选择"按钮 → 多选模式（checkbox overlay）
- 底部浮动操作栏：加入相册 / 导出 / 删除 / 取消

---

## v9.4 — 照片详情增强

### 后端（Go Core）
```
PUT  /api/photos/:id/tags      body: {tags: ["portrait","night","Tokyo"]}
GET  /api/photos/:id/tags      → string[] 
```

### 前端
- PhotoDetail：EXIF 全字段可折叠面板（分组：相机/镜头/曝光/色彩/GPS）
- 关键词标签：可编辑 inline chip 组件
- AI 分析结构化展示（标题/艺术分析/构图/修图意图/拍摄建议 分栏显示）

---

## v9.5 — UX 打磨

- Gallery 虚拟滚动（@tanstack/virtual）避免大量 DOM 节点
- 上传/操作 Skeleton loader 占位符
- 导出/AI 触发后乐观更新状态（pending → done）
- 移动端：触摸手势缩放图片预览（hammer.js 或原生 PointerEvent）
- 图片懒加载 `loading="lazy"` + 渐进显示 blur-up 效果

---

## 测试规范

每个子版本需包含：
- **Go 单元测试**：新增纯函数测试（bulk、overlay 路径解析等）
- **集成测试**：`tests/integration_test.py` 新增对应 section
- **多轮集成测试**：连续 2 次 全通过 才可提交
