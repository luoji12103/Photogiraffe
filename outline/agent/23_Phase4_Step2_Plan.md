# v4.1 预设管理 — 实施计划

**日期**: 2026-02-22  
**基于**: 21_Phase4_Roadmap.md

---

## 设计范围（精简版）
本节聚焦于 JSON 调色参数预设，不实现 XMP/Lightroom 文件解析（过于复杂，推迟为可选扩展）。

---

## 改动范围

### 1. Go Core

**`go-core/models/models.go`**  
- 新增 `Preset` 结构体：`UserID`, `Name`, `Description`, `AdjustParams (jsonb)`

**`go-core/database/db.go`**  
- AutoMigrate 增加 `Preset`

**`go-core/main.go`**  
- `POST /api/presets` — 保存当前调色参数为命名预设
- `GET  /api/presets` — 列出所有预设（按创建时间倒序）
- `DELETE /api/presets/:id` — 删除预设

### 2. 前端

**`frontend/src/components/PresetPanel.tsx`**（新建）  
- 折叠 Accordion（与 ExportPanel 同风格）
- 顶部显示预设列表（每个预设显示名称 → 点击应用）
- "Save current" 按钮 → 弹出名称输入框 → 保存
- 每个预设右侧有删除按钮

**`frontend/src/app/api/presets/route.ts`**（新建）  
- GET: 代理到 go-core `/api/presets`
- POST: 代理到 go-core `/api/presets`

**`frontend/src/app/api/presets/[id]/route.ts`**（新建）  
- DELETE: 代理到 go-core `/api/presets/:id`

**`frontend/src/components/PhotoDetail.tsx`**  
- import `PresetPanel`
- 在 AdjustPanel 上方添加 `<PresetPanel params={adjustParams} onApply={setAdjustParams} />`

---

## Preset DB Schema
```go
type Preset struct {
    gorm.Model
    UserID       uint   `gorm:"not null;index"`
    Name         string `gorm:"not null"`
    Description  string
    AdjustParams string `gorm:"type:jsonb;not null"` // serialized AdjustParams JSON
}
```

---

## AdjustParams JSON 格式（对应 gl-renderer.ts）
```json
{
  "exposure":   0.0,
  "brightness": 0.0,
  "contrast":   0.0,
  "saturation": 1.0,
  "tonemap":    false
}
```
