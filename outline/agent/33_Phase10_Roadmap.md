# Phase 10 Roadmap — Admin 强化、预设解析、瀑布流布局与设置重构

> 编写日期：2026-02-24
> 状态：In Progress
> 前序：Phase 9 全部完成（v9.1–v9.5，commit `01f8f0d`）

---

## 背景

Phase 9 完成了导出水印叠加、照片公开/私密、批量操作与公开作品集。
Phase 10 聚焦**管理能力**、**预设生态**、**浏览体验**和**系统设置**，核心目标：

| 需求来源 | Phase 10 目标 |
|--------|-------------|
| 超级管理员需要更完整的用户管理 | v10.1 |
| 预设上传流程繁琐；需支持 XMP/LrTemplate 解析 | v10.2 |
| 照片墙布局单一，缺少排序控制 | v10.3 |
| 照片详情页混合展示/编辑，多用户场景有问题 | v10.4 |
| 设置页仅 AI API，存储后端配置缺失 | v10.5 |

---

## 子版本列表

| 版本 | 方向 | 核心功能 |
|------|------|---------|
| **v10.1** | Admin 用户管理强化 | 修改用户角色、删除用户、查看用户照片数 / 上传量；后台统计摘要 |
| **v10.2** | 预设解析与在线预览 | 解析 `.xmp`/`.lrtemplate` 提取调色参数；从 RAW EXIF 提取内嵌修图参数；照片详情页在线预览预设效果 |
| **v10.3** | 瀑布流布局 + 排序 | 自适应 Masonry 瀑布流（按照片真实宽高动态排布）；排序：按日期↑↓、相机型号、ISO、文件名 |
| **v10.4** | 照片详情浏览 / 编辑分离 | `/photo/[id]` 默认为纯浏览模式；拥有者看到浮动「编辑」按钮打开侧边编辑面板；访客无编辑入口 |
| **v10.5** | 设置重构 + 存储后端 | 设置页分栏：**通用 / AI API / 存储 / 账号**；Admin 存储后端配置：可切换 MinIO / 兼容 S3 / WebDAV |

---

## 实施顺序

```
v10.1 → v10.3 → v10.4 → v10.2 → v10.5
```
（先做纯前端/简单后端，再做复杂解析和存储后端）

---

## API 变更汇总

### v10.1 (Admin 用户管理)
```
GET  /api/admin/stats                        → 系统摘要 (users/photos/storage)
PUT  /api/admin/users/:id/role               → {role: "SuperAdmin"|"StandardUser"}
DELETE /api/admin/users/:id                  → 软删除用户 + 级联删除其数据
GET  /api/admin/users/:id/photos             → 用户照片列表（带分页）
```

### v10.2 (预设解析)
```
POST /api/presets/parse-xmp                  → 上传 .xmp/.lrtemplate 文件，返回 AdjustParams JSON
POST /api/presets/extract-raw/:photo_id      → 从已上传 RAW 提取内嵌调色参数
GET  /api/photos/:id/preset-preview          → 返回 {adjust_params, source: "uploaded"|"inferred"|"raw_embedded"}
```

### v10.3 (排序)
```
GET /photos?sort=date_desc|date_asc|camera|iso|filename   → 在已有分页端点扩展 sort 参数
```

### v10.5 (存储后端)
```
GET  /api/admin/storage                      → 当前存储配置
PUT  /api/admin/storage                      → 更新存储配置
POST /api/admin/storage/test                 → 连通性测试
```
存储配置模型：`StorageConfig { Backend: "minio"|"s3"|"webdav", Endpoint, Bucket, AccessKey, SecretKey, RootPath, UseSSL }`

---

## 前端页面变更

| 页面 | 变更 |
|------|------|
| `/admin` | 新增 tab: **统计摘要**；用户 tab 增加角色修改、删除、查看照片按钮 |
| `/photo/[id]` | 拆分为 ViewMode（默认）+ 拥有者隐藏编辑面板；移除整页编辑混入 |
| `/` (Gallery) | 布局切换（Grid / Masonry）+ 排序控件 |
| `/settings` | 重构为 4 个 tab；原 AI API 配置移入"AI API"分类；新增"存储"页(仅 Admin) |

---

## 新增 Models

```go
// StorageConfig — 存储后端配置（全局唯一记录，id=1）
type StorageConfig struct {
    gorm.Model
    Backend   string `gorm:"default:'minio'"` // minio | s3 | webdav
    Endpoint  string
    Bucket    string
    AccessKey string
    SecretKey string `gorm:"type:text"` // encrypted at rest (future)
    RootPath  string
    UseSSL    bool   `gorm:"default:true"`
    Region    string // S3 region (optional)
}
```

---

## 测试规划

- Go 单元测试：`TestAdminDeleteUser_CascadePhotos`, `TestParseXMP_BasicParams`, `TestStorageConfig_CRUD`
- 集成测试新增 `test_phase10()`: 覆盖 admin 统计、角色修改、预设解析、排序参数、设置 CRUD
- 前端视觉验收：Masonry 在 4/8/12 张照片下均无重叠；预设预览与 WebGL2 渲染一致

---

## 技术备注

- **XMP 解析**：Go 原生 XML 解析 `<rdf:Description>` 节点，映射 `crs:*` 属性到 AdjustParams
- **LrTemplate 解析**：Lightroom 经典 Lua-like 文本格式，用正则提取 key-value 对
- **Masonry**：使用 CSS `columns` 属性方案（无 JS 高度计算），配合 `break-inside: avoid` 保证图片完整显示，利用 `image.naturalWidth/Height` 做 inline `aspect-ratio` 预占位
- **存储抽象**：Go Core 定义 `StorageProvider interface { Upload/Download/Delete/URL }`，python-worker 从 Go Core 内部 API 读取配置
