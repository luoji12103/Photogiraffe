# Phase 12 — 测试修复 + 前端页面主题适配

> 日期：2026-02-25
> 前置：Phase 11 全部完成（v11.1–v11.5），集成测试 127/129（2 项 pre-existing 失败）

## 目标

1. **修复 2 项 pre-existing 集成测试失败**，将通过率从 127/129 提升至 129/129
2. **将 /profile、/map、/compare 三个页面**全面适配 Phase 11 引入的 pg-* CSS 设计 Token 体系

## Sub-versions

### v12.1 — 修复 2 项预存在的集成测试失败

**Bug 1：Returned preset ID matches**
- 根因：`GET /api/photos/:id/preset` 返回 `{"preset": {...}}`，测试执行 `d.get("ID")` 在顶层找不到 ID
- 修复：response 改为 `fiber.Map{"preset": preset, "ID": preset.ID, "id": preset.ID}`，ID 同时出现在顶层和嵌套对象

**Bug 2：public photos only (no private)**
- 根因：`PublicPhoto` struct 无 `is_public` 字段，序列化 JSON 不含该键，测试 `p.get("is_public", False)` 恒为 False
- 修复：结构体加 `IsPublic bool json:"is_public"`，赋值 `true`（已过滤 `WHERE is_public=true`）

### v12.2 — /profile 页面主题适配

- 完整重写 `/profile/page.tsx`（~371 行）
- 统一使用 pg-* CSS 变量（`--pg-bg-base`, `--pg-text-primary`, `--pg-accent` 等）
- stats 行展示照片/相册/预设统计数字
- 公开作品集快捷入口按钮（`/p/{username}`）
- framer-motion 入场动画

### v12.3 — /map 页面主题适配

- 重写 `map/page.tsx`（~98 行）
- pg-* token 全面替换硬编码颜色
- motion.div header + 改善空状态

### v12.4 — /compare 页面主题适配

- 重写 `compare/page.tsx`（~139 行）
- pg-* token、AlertCircle 错误提示、motion header

## 约束

- 仅修改前端样式层和 Go Core 响应格式，不改变业务逻辑
- 集成测试目标：**129/129**
