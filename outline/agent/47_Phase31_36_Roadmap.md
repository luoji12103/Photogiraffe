# Phase 31-36 Roadmap — 评级/颜色标签/标签管理/配额/通知/幻灯片/元数据编辑

**Date:** 2026-03-03  
**Status:** ✅ Completed  
**Commit:** `967db9f`  
**Tests:** 299/301 PASS

---

## 阶段目标

为 Photogiraffe 补充摄影工作流中缺失的核心功能：

- **Phase 31**：照片评级（1-5 星）+ 颜色标签（6 色）→ 二次筛选分类
- **Phase 32**：标签管理（重命名/合并/删除）→ 避免标签碎片化
- **Phase 33**：存储配额管理（10GB 默认）→ 多用户资源控制
- **Phase 34**：通知中心（持久化通知、已读状态）→ 任务完成感知
- **Phase 35**（跳过，替换为幻灯片播放器）：相册幻灯片全屏浏览
- **Phase 36**：照片元数据编辑（DB-only）+ 批量时间偏移

---

## 交付清单

### Phase 31 — 照片评级 & 颜色标签

| 子版本 | 状态 | 内容 |
|--------|------|------|
| v0.31.1 | ✅ | models.go Photo.Rating(int) + Photo.ColorLabel(string) |
| v0.31.2 | ✅ | main.go PATCH /api/photos/:id/rating + PATCH /api/photos/:id/color-label |
| v0.31.3 | ✅ | bulk handler 扩展：set_rating、set_color_label actions |
| v0.31.4 | ✅ | search 扩展：rating_min、color_label 过滤参数 |
| v0.31.5 | ✅ | Frontend proxy routes: rating/route.ts, color-label/route.ts |
| v0.31.6 | ✅ | PhotoDetail: 星级 UI + 颜色圆点；PhotoGrid: 卡片指示器 |

### Phase 32 — 标签管理

| 子版本 | 状态 | 内容 |
|--------|------|------|
| v0.32.1 | ✅ | main.go GET/PUT/POST /api/tags, DELETE /api/tags/:name |
| v0.32.2 | ✅ | Frontend proxy: tags/route.ts, tags/[name]/route.ts |
| v0.32.3 | ✅ | search/page.tsx 标签管理面板 |

### Phase 33 — 存储配额

| 子版本 | 状态 | 内容 |
|--------|------|------|
| v0.33.1 | ✅ | models.go User.StorageQuotaBytes(10GB) + StorageUsedBytes |
| v0.33.2 | ✅ | main.go GET /api/storage/usage + PUT /api/admin/users/:id/quota |
| v0.33.3 | ✅ | Frontend proxy + settings/page.tsx 用量进度条 |

### Phase 34 — 通知中心

| 子版本 | 状态 | 内容 |
|--------|------|------|
| v0.34.1 | ✅ | models.go Notification struct + database/db.go AutoMigrate |
| v0.34.2 | ✅ | main.go CRUD 4 端点 |
| v0.34.3 | ✅ | Frontend proxy routes (2 文件) |
| v0.34.4 | ✅ | app/notifications/page.tsx 全功能通知中心 |
| v0.34.5 | ✅ | ClientLayout.tsx Bell 图标 + 导航链接 |

### Phase 35（调整 → 幻灯片播放器）

| 子版本 | 状态 | 内容 |
|--------|------|------|
| v0.35.1 | ✅ | SlideshowModal.tsx 新组件（全屏、播放控制、键盘快捷键）|
| v0.35.2 | ✅ | albums/[id]/page.tsx 接入幻灯片按钮 |

### Phase 36 — 照片元数据编辑

| 子版本 | 状态 | 内容 |
|--------|------|------|
| v0.36.1 | ✅ | main.go PUT /api/photos/:id/metadata |
| v0.36.2 | ✅ | main.go POST /api/photos/batch-date-shift |
| v0.36.3 | ✅ | Frontend proxy routes (2 文件) |
| v0.36.4 | ✅ | PhotoDetail editMode EXIF 编辑面板 |
| v0.36.5 | ✅ | 集成测试 test_phase31–test_phase36 |
| v0.36.6 | ✅ | 修复编译/TypeScript 错误，go-core + frontend 重新构建部署 |

---

## 新增 API 汇总

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| PATCH | /api/photos/:id/rating | JWT（同属）| 设置评级 0-5 |
| PATCH | /api/photos/:id/color-label | JWT（同属）| 设置颜色标签 |
| GET | /api/tags | JWT | 列出所有 tag 及计数 |
| PUT | /api/tags | JWT | 重命名 tag |
| POST | /api/tags | JWT | 合并 tag |
| DELETE | /api/tags/:name | JWT | 删除 tag |
| GET | /api/storage/usage | JWT | 当前用户存储用量 |
| PUT | /api/admin/users/:id/quota | JWT+SA | 设置用户配额 |
| GET | /api/notifications | JWT | 通知列表（分页）|
| PUT | /api/notifications | JWT | 全部已读 |
| PUT | /api/notifications/:id | JWT | 单条已读 |
| DELETE | /api/notifications/:id | JWT | 删除通知 |
| PUT | /api/photos/:id/metadata | JWT（同属）| 编辑元数据字段 |
| POST | /api/photos/batch-date-shift | JWT | 批量时间偏移 |

---

## 设计决策记录

| 决策 | 选项 | 说明 |
|------|------|------|
| 存储配额默认值 | 10 GB | `StorageQuotaBytes: 10737418240` |
| 标签管理位置 | 搜索页内嵌 | 而非独立标签页 |
| 通知持久化 | 仅新事件，不回填历史 | 避免数据库膨胀 |
| EXIF 编辑 | 仅更新 DB 字段 | 不写回原始文件（文件不可变原则）|

---

## 技术注意事项

1. `Photo.Tags` 为 `*string` 指针（JSON 数组），tag 操作须 Unmarshal/Marshal 处理，不能直接 SQL LIKE 重命名
2. `batch-date-shift` 使用 PostgreSQL `make_interval(secs => ?)` 原子更新，避免时区问题
3. `StorageUsedBytes` 当前不做上传拦截，仅为展示用途；上传配额检查留作后续激活
4. `Notification.Type` 预定义值：`ai_done | export_done | backup_done | info`
5. 前端 `user.id` 为 UUID string，`n.user_id` 为 uint，比较须 `String(n.user_id) === user.id`
