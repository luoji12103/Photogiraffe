# v5.2 — Feature Flags 管理 API + Admin Panel UI

## 目标

实现 Feature Flags 运行时开关管理，以及 SuperAdmin 专属后台管理页面（Feature Flags + 用户列表）。

---

## 实施内容

### Go Core 新增路由

| 路由 | 说明 |
|------|------|
| `GET /api/admin/flags` | 列出所有 Feature Flags（SuperAdmin） |
| `PUT /api/admin/flags/:name` | 切换 Feature Flag 开关（SuperAdmin） |
| `GET /api/feature/:name` | 查询单个 Feature Flag 是否启用（需 JWT） |
| `GET /api/admin/users` | 列出所有用户（SuperAdmin） |

### Frontend 新增文件

| 文件 | 说明 |
|------|------|
| `src/app/api/admin/flags/route.ts` | GET /api/admin/flags 代理 |
| `src/app/api/admin/flags/[name]/route.ts` | PUT /api/admin/flags/:name 代理 |
| `src/app/api/admin/users/route.ts` | GET /api/admin/users 代理 |
| `src/app/admin/page.tsx` | Admin Panel（Feature Flags + Users 双 Tab，AuthGuard adminOnly） |

### ClientLayout 变更

AppHeader 中 Settings 图标 → Settings + Admin 两个入口（均限 SuperAdmin）。

---

## Feature Flag 数据结构

```go
// GET /api/admin/flags 返回
[{"id":1,"feature_name":"ai_analysis","is_enabled":false,"description":"..."}]

// PUT /api/admin/flags/:name body
{"is_enabled": true}
```

---

## Admin Panel UI 设计

- Tab 1: Feature Flags — 6 张 Flag 卡片，toggle 开关
- Tab 2: Users — 用户表格（ID / Username / Email / Role / CreatedAt）
- 使用 AuthGuard adminOnly
- 与 /settings 风格一致（dark zinc theme）
