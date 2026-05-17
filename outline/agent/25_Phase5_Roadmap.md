# Phase 5 Roadmap — 商业化与多用户架构

**日期**: 2026-02-22  
**分支**: s4.6full-stack  
**前序提交**: a568171 (v4.2)

---

## 目标

将单用户 admin-token 架构升级为完整的多用户 JWT 认证体系，实现基于角色的访问控制（RBAC）和多用户数据隔离，并提供 Feature Flag 管理后台，为 SaaS 化奠定基础。

---

## 现状分析

| 项目 | 当前状态 |
|------|---------|
| 认证 | 单一 `ADMIN_TOKEN` 静态 Bearer 校验 |
| 用户模型 | `User` 表已存在（含 `Role` 字段），无 JWT 支持 |
| UserID | 所有写操作 hardcode `UserID: 1` |
| 多用户隔离 | 无，任意 token 可访问所有数据 |
| Feature Flag | `FeatureFlag` 模型已存在，但无管理 API |
| 前端 | 无登录/注册页面，无 Auth 状态管理 |

---

## Step 1 — v5.0: JWT 认证体系

### 后端 (Go Core)

#### 依赖
- 新增 `github.com/golang-jwt/jwt/v5` + `golang.org/x/crypto`（bcrypt，已在间接依赖中）

#### 新模型
- `RefreshToken`：`user_id`, `token_hash (sha256)`, `expires_at`, `revoked bool`

#### 新环境变量
- `JWT_SECRET`（≥32 字节随机字符串）
- `JWT_ACCESS_TTL`（默认 `15m`，Access Token 有效期）
- `JWT_REFRESH_TTL`（默认 `7d`，Refresh Token 有效期）

#### 新 API 端点
| Method | Path | Auth | 功能 |
|--------|------|------|------|
| POST | `/api/auth/register` | 无（首次注册 → SuperAdmin；后续 → StandardUser） | 用户注册 |
| POST | `/api/auth/login` | 无 | 登录，返回 access_token + refresh_token |
| POST | `/api/auth/refresh` | Refresh Token（Cookie） | 颁发新 Access Token |
| POST | `/api/auth/logout` | JWT | 撤销 Refresh Token |
| GET  | `/api/auth/me` | JWT | 返回当前用户信息 |

#### JWT Middleware
- `requireJWT()` — 验证 Bearer access_token，写入 `c.Locals("userID")` 和 `c.Locals("userRole")`
- `requireRole(roles ...string)` — 必须在 `requireJWT` 之后使用，检查角色

#### 迁移现有路由
所有原 `requireAuth(adminToken)` 替换为 `requireJWT()`，敏感路由叠加 `requireRole("SuperAdmin")`

#### Hardcode UserID 修复
将 `UserID: 1` 改为读取 `c.Locals("userID").(uint)`

### 前端 (Next.js)

#### 页面
- `/login` — 登录表单（用户名+密码）
- `/register` — 注册表单（仅在无用户时，或管理员邀请时）

#### Auth 状态管理
- `src/lib/auth.ts` — `AuthContext`（`user`, `isLoading`, `login()`, `logout()`, `refreshToken()`）
- Access Token 存于 `sessionStorage`（防 XSS 最简方案）；Refresh Token 通过 httpOnly Cookie 传输
- `src/components/AuthGuard.tsx` — 包裹受保护页面，未登录跳转 `/login`

#### Header 升级
- 右上角显示用户名 + 退出按钮
- API 请求自动附加 `Authorization: Bearer <access_token>`，过期时透明 refresh

---

## Step 2 — v5.1: RBAC 权限与多用户隔离

### 后端 (Go Core)

所有数据查询增加 `user_id = ?` 过滤，确保用户只能访问自己的资源：

| 模型 | 隔离方式 |
|------|---------|
| Photo | `WHERE user_id = ?` |
| ExportJob | `WHERE user_id = ?` |
| Preset | `WHERE user_id = ?` |
| AIConfig | SuperAdmin 全局共享（单条记录，无 user_id 隔离） |
| FeatureFlag | SuperAdmin 管理，StandardUser 只读 |

#### SuperAdmin 专属路由（叠加 `requireRole("SuperAdmin")`）
- `/api/config/ai`（GET/POST）
- `/api/admin/flags`（GET/PUT）
- `/api/admin/users`（GET，用户列表概览）

### 前端 (Next.js)
- 根据 `user.role` 动态显示/隐藏 AI Config、Admin 入口
- 上传、导出、预设等操作不再需要携带硬编码 token

---

## Step 3 — v5.2: 功能开关与管理后台

### 后端 (Go Core)

#### Feature Flag API（SuperAdmin）
- `GET  /api/admin/flags` — 列出所有 Feature Flag
- `PUT  /api/admin/flags/:name` — `{ "is_enabled": true/false }`
- `GET  /api/feature/:name` — 任意用户查询单个 flag 状态（用于前端条件渲染）

#### Feature Flag 预置
启动时 `upsert` 以下默认 flag（若不存在则插入 `is_enabled=false`）：

| FeatureName | 默认 | 用途 |
|-------------|------|------|
| `ai_analysis` | false | AI 艺术分析功能 |
| `ai_infer_params` | false | AI 参数推断功能 |
| `export_engine` | true | 导出引擎 |
| `preset_management` | true | 预设管理 |
| `raw_decode` | true | 浏览器端 RAW 解码 |
| `hdr_display` | true | 广色域/HDR 渲染 |

#### Feature Flag Middleware
```go
func requireFlag(flagName string) fiber.Handler {
    // 从 DB 或内存缓存读取 flag，若 false 返回 403
}
```
叠加到 AI 相关路由和导出路由上。

### 前端 (Next.js)

#### 管理后台 `/admin`
- SuperAdmin 专属页面（`AuthGuard` + role check）
- **AI 配置** tab：Provider/API Key/Model 设置表单（原 `/settings` 升级）
- **Feature Flags** tab：开关列表（toggle），实时更新
- **用户列表** tab：用户名/注册时间/角色展示

#### 前端 Feature Flag 集成
- `src/hooks/useFeatureFlag.ts` — SWR 查询 `/api/feature/:name`
- `ExportPanel`、`PresetPanel`、`ColorSpaceIndicator` 各自根据 flag 决定是否渲染

---

## 文件变更预测

| 阶段 | 新建文件 | 修改文件 |
|------|---------|---------|
| v5.0 | `go-core/auth/jwt.go`, `frontend/src/app/login/page.tsx`, `frontend/src/app/register/page.tsx`, `frontend/src/lib/auth.ts`, `frontend/src/components/AuthGuard.tsx` | `go-core/go.mod`, `go-core/main.go`, `go-core/models/models.go`, `go-core/database/db.go`, `frontend/src/components/ClientLayout.tsx` |
| v5.1 | — | `go-core/main.go`（所有查询加 user_id 过滤） |
| v5.2 | `frontend/src/app/admin/page.tsx`, `frontend/src/hooks/useFeatureFlag.ts` | `go-core/main.go`（flag API + middleware）, `frontend/src/components/ExportPanel.tsx`, `frontend/src/components/PresetPanel.tsx` |

---

## 风险与决策

| 风险 | 应对 |
|------|------|
| 迁移现有 UserID=1 数据 | AutoMigrate 不删数据；旧数据仍属 user_id=1，新注册首个账户自动分配 ID=1（若 DB 为空） |
| Refresh Token 存储 | 采用 httpOnly + SameSite=Strict Cookie，后端存 SHA-256 hash |
| 首次部署无用户 | 第一个注册者自动设为 SuperAdmin |
| 前端 token 刷新竞态 | 单例 refresh Promise，多个请求等待同一次刷新 |
