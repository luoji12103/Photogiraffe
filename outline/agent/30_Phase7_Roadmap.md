# Phase 7 Roadmap — Advanced Features & Photography Identity

> 编写日期：2026-02-24
> 状态：In Progress
> 前序：Phase 6 全部完成（v6.1–v6.5，commit 4338909）

---

## 背景

Phase 6 完成了生产就绪加固。Phase 7 聚焦于**摄影师身份、照片组织与高级交互体验**，对应 InitialThoughts.md 中尚未实现的核心需求：

| InitialThoughts 条目 | 当前状态 | Phase 7 目标 |
|--------------------|---------|------------|
| 条目6：预设系统（平台标签 / 下载 / 预览 / 应用到任意照片）| 部分实现（保存/载入，无平台标签、无文件下载、无横向应用） | v7.5 |
| 条目10：对比视图 | 未实现 | v7.2 |
| 条目12：EXIF GPS 坐标在地图上显示 | GPS 已存储，但无地图 UI | v7.1 |
| 条目13：摄影师头像/签名上传，导出时叠加 | 签名/水印路径存于导出选项，但无个人档案上传入口 | v7.4 |
| 图片组织 | 无相册/集合功能 | v7.3 |

---

## 子版本列表

| 版本 | 方向 | 描述 |
|------|------|------|
| v7.1 | GPS 地图展示 | PhotoDetail 中集成 Leaflet 地图，显示拍摄地点；画廊页支持"按地点"浏览 |
| v7.2 | 对比视图 | 选择两张照片并排 / 分屏对比，支持同步 WebGL 调整 |
| v7.3 | 相册/集合管理 | 创建命名相册，批量归类照片，相册封面，相册分享 |
| v7.4 | 用户档案与摄影师身份 | 个人简介、头像、签名图（PNG 透明），导出时可叠加 |
| v7.5 | 增强预设系统 | 预设绑定平台标签（Lightroom/Pixelmator 等）、预设文件下载、跨照片应用预设 |

---

## API 变更汇总（Phase 7 新增）

### v7.1 (GPS)
- 无新 API（直接读现有 `exif_data.gps_latitude / gps_longitude`）
- Go Core 新增：`GET /api/photos/map` → 返回所有已完成照片的 `{id, lat, lng, thumbnail_path}` 列表（用于地图聚类）

### v7.2 (Compare)
- 纯前端功能，无新后端 API

### v7.3 (Albums)
- `POST /api/albums` — 创建相册 `{name, description, cover_photo_id?}`
- `GET /api/albums` — 当前用户相册列表
- `GET /api/albums/:id` — 相册详情（含照片列表）
- `PUT /api/albums/:id` — 更新名称/描述/封面
- `DELETE /api/albums/:id` — 删除相册（照片不删除）
- `POST /api/albums/:id/photos` — 批量添加照片 `{photo_ids: [...]}`
- `DELETE /api/albums/:id/photos/:photo_id` — 从相册移除照片
- `POST /api/albums/:id/share` — 生成相册公开分享链接（与 v6.3 分享机制一致）
- `GET /share/album/:token` — 公开访问相册

### v7.4 (Profile)
- `GET /api/profile` — 当前用户档案（bio, avatar_url, signature_url）
- `PUT /api/profile` — 更新 bio
- `POST /api/profile/avatar` — 上传头像（multipart/form-data）
- `POST /api/profile/signature` — 上传签名图（PNG，保留透明通道）

### v7.5 (Enhanced Presets)
- `PUT /api/presets/:id` — 更新预设（含 `platforms`、`file_download_url`）
- `POST /api/presets/:id/apply/:photo_id` — 将预设应用到指定照片（写入该照片的 `applied_preset_id`）
- `GET /api/photos/:id/preset` — 获取照片当前应用的预设详情

---

## 数据库变更汇总

### albums（v7.3 新增）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uint PK | — |
| user_id | uint FK | 数据归属 |
| name | string | 相册名称 |
| description | string | 可选描述 |
| cover_photo_id | uint nullable FK | 封面照片 |

### album_photos（v7.3 新增，关联表）
| 列 | 类型 | 说明 |
|----|------|------|
| album_id | uint FK | — |
| photo_id | uint FK | — |

### user_profiles（v7.4 新增）
| 列 | 类型 | 说明 |
|----|------|------|
| user_id | uint PK FK | 一对一关联 users |
| bio | text | 摄影师简介 |
| avatar_path | string | MinIO 路径 |
| signature_path | string | MinIO 路径（PNG 透明） |
| website | string | 可选个人网站 |
| location | string | 城市/国家 |

### presets 增强字段（v7.5）
| 新增列 | 类型 | 说明 |
|-------|------|------|
| platforms | string | JSON array，如 `["Lightroom","PixelCake"]` |
| file_path | string | MinIO 路径（预设文件原件，可下载）|

### photos 增强字段（v7.5）
| 新增列 | 类型 | 说明 |
|-------|------|------|
| applied_preset_id | uint nullable FK | 当前应用的预设 |

---

## 依赖关系

```
v7.1（独立，仅读 exif）
    ↓
v7.2（前端对比，独立）
    ↓
v7.3（相册，需要 photos 存在）
    ↓
v7.4（用户档案，需要 MinIO 存在）
    ↓
v7.5（增强预设，依赖 presets + photos）
```

---

## 前端新增页面/组件

| 路径 | 说明 |
|------|------|
| `frontend/src/app/map/page.tsx` | GPS 世界地图浏览页（v7.1）|
| `frontend/src/components/MapView.tsx` | Leaflet 地图组件（v7.1）|
| `frontend/src/app/compare/page.tsx` | 对比视图页（v7.2）|
| `frontend/src/components/CompareView.tsx` | 分屏对比组件（v7.2）|
| `frontend/src/app/albums/page.tsx` | 相册列表页（v7.3）|
| `frontend/src/app/albums/[id]/page.tsx` | 相册详情页（v7.3）|
| `frontend/src/app/share/album/[token]/page.tsx` | 相册公开分享页（v7.3）|
| `frontend/src/app/profile/page.tsx` | 用户档案编辑页（v7.4）|
| `frontend/src/components/ProfileCard.tsx` | 档案展示卡片（v7.4）|

---

## 技术选型

| 功能 | 方案 | 理由 |
|------|------|------|
| GPS 地图 | `leaflet` + `react-leaflet` + 免费 OpenStreetMap 底图 | 零成本、无 API Key、离线可用 |
| 对比视图 | 原生 CSS flex + 共享 WebGL context | 避免引入大型库，与现有 AdjustPanel 复用 |
| 图片上传（头像/签名）| 现有上传基础设施（NextJS proxy → Go Core → MinIO） | — |
| 预设文件 | .xmp / .lrtemplate / .cube 等直接存 MinIO，预签名 URL 下载 | — |
