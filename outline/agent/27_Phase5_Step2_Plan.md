# v5.1 — RBAC 多用户数据隔离

## 目标

在 v5.0 JWT 认证基础上，实施用户级数据隔离：每个用户只能看到并操作自己上传的照片和预设；SuperAdmin 可查看所有数据。

---

## 当前问题

| 路由 | 问题 |
|------|------|
| `GET /photos` (go-core) | 无 JWT，返回所有用户照片 |
| `GET /photos/:id` (go-core) | 无 JWT，任意用户可读取他人照片 |
| `POST /api/photos/:id/analyze` | 未验证 photo.UserID == 请求者 |
| `POST /api/photos/:id/infer-params` | 同上 |
| `GET /api/photos/:id/exports` | 同上 |
| `GET /api/presets` | 返回所有用户预设 |
| `POST/DELETE /api/presets/:id` | 未验证归属 |
| `page.tsx` (Next.js) | SSR 直连 go-core /photos 无 token |
| `api/photos/[id]/route.ts` | 未转发 Authorization header |

---

## 实施计划

### Step 1: go-core 数据隔离

**1a. `GET /photos`**
- 加 `requireJWT()`
- SuperAdmin：`db.Find(&photos)` 返回全部
- 普通用户：`db.Where("user_id = ?", uid).Find(&photos)`

**1b. `GET /photos/:id`**
- 加 `requireJWT()`
- 查到后检查 `photo.UserID == uid || role == "SuperAdmin"`，否则 403

**1c. `POST /api/photos/:id/analyze` + `POST /api/photos/:id/infer-params`**
- 已有 `requireJWT()`
- 在 Find 之后加归属检查

**1d. `GET /api/photos/:id/exports` + 导出下载路由**
- 加归属检查

**1e. `GET /api/presets`**
- 普通用户：`WHERE user_id = uid`
- SuperAdmin：全部

**1f. `POST /api/presets`**
- 已有 `requireJWT()`，`UserID` 已用 `userIDFromLocals`，无需改动

**1g. `PUT /api/presets/:id` + `DELETE /api/presets/:id`**
- 查到后验证归属

### Step 2: Next.js 代理路由补全

**`src/app/api/photos/[id]/route.ts`**
- 改为 `(request: NextRequest)` 签名
- 转发 `Authorization: Bearer <token>` 到 go-core

**新增 `src/app/api/photos/route.ts`**
- GET 代理，转发 Authorization

### Step 3: Frontend Gallery 改为 CSR

**`src/app/page.tsx`**
- 改为 `"use client"` 组件
- `useEffect` + `authFetch("/api/photos")` 加载照片列表
- 替换 SSR `getPhotos()` 函数
- 加载中显示 skeleton

---

## 变更文件清单

| 文件 | 类型 |
|------|------|
| `go-core/main.go` | 修改 |
| `frontend/src/app/page.tsx` | 修改（SSR → CSR） |
| `frontend/src/app/api/photos/route.ts` | 新建 |
| `frontend/src/app/api/photos/[id]/route.ts` | 修改 |

---

## 测试要点

1. 用户 A 登录 → 只见自己的照片
2. 用户 A 访问用户 B 的 photo_id → 403
3. SuperAdmin 登录 → 见所有照片
4. 无 token 访问 /api/photos → 401
5. 预设隔离：用户 A 的预设用户 B 看不到
