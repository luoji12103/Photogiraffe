# Phase 23 Roadmap — 照片批注与时间线 (v0.23)

**Date:** 2026-02-26  
**Status:** Planned  
**Priority:** Low

---

## 目标

为照片添加私人批注功能，并提供按时间线浏览照片的视图。

- **照片批注（Notes）**：每张照片可添加多条时间戳私人笔记（仅自己可见）
- **时间线视图**：`/timeline` 页面，按拍摄日期分组展示照片（年/月/日分组）
- **快速备忘录**：在 PhotoDetail 侧边添加 Notes 面板，支持 Markdown 简单格式

---

## 版本规划

| 子版本 | 内容 | 涉及文件 |
|--------|------|----------|
| v0.23.1 | Go Core: PhotoNote 模型 + CRUD 端点 | `go-core/models/models.go`, `go-core/database/db.go`, `go-core/main.go` |
| v0.23.2 | Frontend: NotesPanel 组件集成 PhotoDetail | `frontend/src/components/PhotoDetail.tsx`, 新建 `frontend/src/components/NotesPanel.tsx` |
| v0.23.3 | Frontend: /timeline 页面 + 代理路由 + 侧边栏入口 | `frontend/src/app/timeline/page.tsx`, `frontend/src/components/ClientLayout.tsx` |
| v0.23.4 | 测试 + build + commit | `tests/integration_test.py` |

---

## 技术实现

### PhotoNote 模型
```go
type PhotoNote struct {
    gorm.Model
    PhotoID   uint   `gorm:"not null;index"`
    UserID    uint   `gorm:"not null"`
    Content   string `gorm:"type:text;not null"` // Markdown 内容
    IsPrivate bool   `gorm:"default:true"`
}
```

### API 端点
```
GET  /api/photos/:id/notes       → [{ID, Content, CreatedAt, IsPrivate}]
POST /api/photos/:id/notes       → {content, is_private}   → 201
PUT  /api/photos/:id/notes/:nid  → {content}               → 200
DELETE /api/photos/:id/notes/:nid                           → 200
```

### 时间线 API

`GET /api/photos?sort=date_desc` 接口已有；时间线页面在前端按 `ExifData.DateTimeOriginal`（或 `CreatedAt`）分组渲染，不需新后端端点。

---

## 前端 Notes 面板

在 PhotoDetail 编辑模式下，notes 区域：
```
┌─ 批注笔记 ────────────────────── [+ 添加] ┐
│ ✎ 2026-02-20 14:30                        │
│   这张照片使用了 -2EV 的曝光补偿，        │
│   需要后期加回高光细节...                  │
│                               [编辑][删除] │
│ ✎ 2026-02-21 09:00                        │  
│   参考了 Fan Ho 的阴影处理风格             │
│                               [编辑][删除] │
└───────────────────────────────────────────┘
```

## 时间线页面

```
/timeline
┌─ 2025 ──────────────────────────────────────┐
│  ▼ March 2025  (12 张)                      │
│  [缩略图] [缩略图] [缩略图] [缩略图]         │
│  15日   · 东京街拍· Canon R5                 │
│  ▼ January 2025  (8 张)                     │
│  ...                                         │
├─ 2024 ──────────────────────────────────────┤
│  ...                                         │
└─────────────────────────────────────────────┘
```

分组逻辑：前端从已有 `/photos` API 获取全量（按日期排序），用 `ExifData?.DateTimeOriginal` 提取年月，虚拟滚动渲染大量照片。
