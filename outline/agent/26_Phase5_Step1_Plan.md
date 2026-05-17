# v5.0 Step Plan — JWT 认证体系

**日期**: 2026-02-22  
**目标**: 用完整的 JWT 认证体系替换静态 ADMIN_TOKEN，实现真正的用户注册/登录/凭证管理。

---

## 改动范围

### Go Core
1. **Dockerfile**: 添加 `git` 包 + `go mod tidy`（自动拉取新依赖）
2. **`auth/jwt.go`** (新建): JWT 生成/验证辅助函数
3. **`models/models.go`**: 新增 `RefreshToken` 模型
4. **`database/db.go`**: AutoMigrate 添加 `RefreshToken`
5. **`main.go`**:
   - 新增 `JWT_SECRET` 环境变量读取
   - 新增 `requireJWT()` middleware（验证 access token → 写入 `c.Locals`）
   - 新增 `requireRole(roles ...string)` middleware
   - 新增认证路由: `POST /api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `GET /api/auth/me`
   - 替换所有 `requireAuth(adminToken)` → `requireJWT()`
   - 敏感路由叠加 `requireRole("SuperAdmin")`
   - 修复 `UserID: 1` 硬编码 → 从 JWT Locals 读取

### Frontend (Next.js)
1. **`src/lib/auth.ts`** (新建): AuthContext + provider + hook
2. **`src/components/AuthGuard.tsx`** (新建): 未登录跳转 `/login`
3. **`src/app/login/page.tsx`** (新建): 登录表单
4. **`src/app/register/page.tsx`** (新建): 注册表单
5. **`src/components/ClientLayout.tsx`** (修改): 包裹 `AuthProvider`，顶栏显示用户名+退出
6. **所有 API proxy routes** (修改): 转发浏览器传来的 `Authorization` header 而非硬编码 ADMIN_TOKEN

---

## JWT 设计

```
Access Token:  HS256, 15 分钟有效期
               payload: { sub: userId, username, role, exp }

Refresh Token: 随机 UUID (32 字节)，7 天有效期
               DB 存 SHA-256 hash
               通过 httpOnly Cookie 传输
```

---

## 首次注册规则

- DB 中无用户 → 第一个注册者自动设为 `SuperAdmin`
- 之后注册者均为 `StandardUser`

---

## 环境变量新增（docker-compose.yml）

```yaml
JWT_SECRET: ${JWT_SECRET:-photogiraffe_jwt_secret_change_me_in_prod}
```
