# Phase 22 Roadmap — 账号安全 + SMTP 邮件功能 (v0.22)

**Date:** 2026-02-26  
**Status:** Planned  
**Priority:** Medium（用户选择：包含邮件功能）

---

## 目标

提供完整的账号安全功能，包括密码修改、邮箱/用户名更新，以及基于 SMTP 的邮件服务（注册验证 + 忘记密码）。

- **修改密码**：登录后在设置页更改密码（需验证旧密码）
- **更新个人信息**：修改用户名、邮箱（触发新邮箱验证）
- **SMTP 配置**：SuperAdmin 在存储配置 Tab 旁添加 SMTP 配置 Tab
- **忘记密码**：发送重置链接到邮箱，5 分钟有效 token
- **邮件验证**：注册后可选发送验证邮件（Feature Flag 控制）
- **登录历史**：记录最近 10 次登录 IP + 时间（仅展示，不阻断）

---

## 版本规划

| 子版本 | 内容 | 涉及文件 |
|--------|------|----------|
| v0.22.1 | Go Core: models.go SMTP Config + PasswordResetToken + LoginHistory 模型；DB AutoMigrate | `go-core/models/models.go`, `go-core/database/db.go` |
| v0.22.2 | Go Core: PUT /api/auth/change-password + PUT /api/auth/update-profile | `go-core/main.go` |
| v0.22.3 | Go Core: SMTP config CRUD `/api/admin/smtp` + email service (Go `net/smtp`) | `go-core/main.go` |
| v0.22.4 | Go Core: POST /api/auth/forgot-password + POST /api/auth/reset-password | `go-core/main.go` |
| v0.22.5 | Go Core: 登录时记录 LoginHistory；GET /api/auth/login-history | `go-core/main.go` |
| v0.22.6 | Frontend: 设置页 account tab — 修改密码表单 + 修改用户名/邮箱表单 | `frontend/src/app/settings/page.tsx` |
| v0.22.7 | Frontend: 管理员 SMTP 配置 Tab（admin panel 或 settings/storage）| `frontend/src/app/admin/page.tsx` 或 `settings/page.tsx` |
| v0.22.8 | Frontend: /forgot-password 页 + /reset-password 页 | 新文件 |
| v0.22.9 | 代理路由 + 测试 + build + commit | — |

---

## 技术实现

### SMTP 配置（SmtpConfig model）
```go
type SmtpConfig struct {
    gorm.Model
    Host     string // smtp.gmail.com
    Port     int    // 587
    Username string // noreply@example.com
    Password string // app password（不回传明文）
    FromName string // "Photogiraffe"
    UseTLS   bool   // STARTTLS
    Enabled  bool
}
```

### 密码重置 Token（PasswordResetToken model）
```go
type PasswordResetToken struct {
    gorm.Model
    UserID    uint
    TokenHash string // SHA-256 of random 32-byte hex
    ExpiresAt time.Time
    Used      bool
}
```

### 登录历史（LoginHistory model，仅存最近 10 条/用户）
```go
type LoginHistory struct {
    gorm.Model
    UserID    uint
    IPAddress string
    UserAgent string
    Success   bool
}
```

### API 端点

```
PUT /api/auth/change-password   { old_password, new_password }  → 200 | 400 | 401
PUT /api/auth/update-profile    { username?, email? }           → 200 | 409(conflict) | 400
GET /api/admin/smtp                                              → 200 (password masked)
PUT /api/admin/smtp             { host, port, ... }             → 200
POST /api/admin/smtp/test       → 发送测试邮件 → 200 | 500
POST /api/auth/forgot-password  { email }                       → 200 (always, no enum)
POST /api/auth/reset-password   { token, new_password }         → 200 | 400 | 410
GET /api/auth/login-history                                     → 200 [{ip, time, success}]
```

### Email 模板
- 忘记密码链接：`https://{FRONTEND_URL}/reset-password?token={raw_token}`
- 注册验证链接：`https://{FRONTEND_URL}/verify-email?token={raw_token}`（若启用）

---

## 安全注意事项
1. `POST /api/auth/forgot-password` 始终返回 200（防止邮箱枚举攻击）
2. 重置 token = 32 字节 CSPRNG，存储 SHA-256 hash，原始值仅在邮件中出现一次
3. 修改密码后撤销所有 Refresh Tokens（强制重新登录）
4. SMTP 密码字段响应时返回 `"****"` 占位
5. 登录历史：每次登录 INSERT + 保留最新 10 条（按 UserID 计数，删除旧的）

---

## 前端页面

### 设置页 account tab（扩充）
当前内容（用户信息展示）→ 新增：
1. **修改密码**区块：旧密码 + 新密码 + 确认
2. **账号信息**区块：修改用户名 + 修改邮箱（需二次确认）
3. **登录历史**折叠区块：最近 10 次

### 新页面
- `/forgot-password`：输入邮箱表单 → 发送重置邮件提示
- `/reset-password?token=xxx`：新密码表单 → 成功后跳 /login
