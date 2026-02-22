# Photogiraffe — 开发工作交接文档

> **本文最后更新**：2026-02-22（全量重写）
> **当前已交付至**：v5.2（Phase 5 Step 3）+ docs commit `8a8f5d9`
> **下一步工作**：Phase 6（尚未开始）
> **仓库**：`luoji12103/Photogiraffe`，分支 `s4.6full-stack`
> **最新 commit**：`8a8f5d9` docs: add user-facing README and .env.example

---

## 一、项目简介

Photogiraffe 是面向摄影师的**高画质个人影像管理平台**，核心特性：

- 支持 RAW（ARW/CR2/CR3/NEF 等）、HEIF（HIF）、JPEG 等格式上传
- 自动提取深度 EXIF 元数据（含 ICC Profile、GPS、相机/镜头）
- 浏览器端 WebGL2 实时色彩调整（曝光/对比度/饱和度/色温等）
- 浏览器端 Wasm LibRaw 解码 RAW 文件（Progressive 渐进加载）
- 多提供商 AI 摄影艺术分析（OpenAI、Google、Anthropic、ZhipuAI、DeepSeek、MiniMax）
- AI 推断最佳色彩调整参数，一键应用
- 导出引擎：应用调整后导出 JPEG/PNG/WebP/TIFF
- 预设管理：保存/应用/删除色彩调整方案
- 多用户 JWT 认证（SuperAdmin/StandardUser 角色）+ 数据隔离
- Feature Flag 管理后台（管理员可动态开关功能模块）

---

## 二、技术栈

| 层 | 技术 | 版本/备注 |
|----|------|---------|
| 前端框架 | Next.js App Router | 16.1.6，TypeScript，Tailwind CSS v4 |
| 前端动画 | Framer Motion | Shared Layout Animation |
| 图标 | lucide-react | — |
| 图像渲染 | WebGL2 + Wasm LibRaw | libraw-wasm npm 包 |
| 后端 | Go + Fiber v2 | GORM，PostgreSQL 驱动，bcrypt，JWT HS256 |
| 数据库 | PostgreSQL 15 | GORM AutoMigrate 管理 schema |
| 缓存/队列 | Redis 7 | Redis Streams（Go → Python 任务分发）|
| 对象存储 | MinIO | 单 bucket `photos`，私有访问 |
| 图像处理 | Python 3.12 + Pillow | pillow_heif、rawpy、exifread、ImageCms |
| AI SDK | Python | openai、google-generativeai、anthropic、zhipuai |
| 编排 | Docker Compose | 6 个服务 |

---

## 三、服务架构

```
浏览器 (:3000)
  │
  ├─ GET  /api/image?path=...          → Next.js Server-side MinIO 代理
  ├─ POST /api/upload                  → 注入 Bearer token → Go Core :8080/upload
  ├─ GET  /api/photos                  → 转发 Authorization → Go Core :8080/photos
  ├─ GET  /api/photos/[id]             → 转发 Authorization → Go Core :8080/photos/:id
  ├─ POST /api/photos/[id]/analyze     → 转发 → Go Core
  ├─ POST /api/auth/*                  → 转发（含 Cookie）→ Go Core /api/auth/*
  ├─ GET/PUT /api/admin/*              → 转发 Authorization → Go Core /api/admin/*
  └─ GET/POST /api/config/ai           → 转发 → Go Core /api/config/ai

Go Core (:8080，绑定 127.0.0.1)
  │
  ├─ POST /upload                      → MinIO (raw/) + Redis Stream photogiraffe_tasks
  ├─ PUT  /internal/photos/:id/status  ← Python Worker 回调（需 X-Internal-Secret）
  ├─ PUT  /internal/photos/:id/analysis ← Python Worker AI 分析回调
  ├─ PUT  /internal/photos/:id/inferred-params ← Python Worker infer 回调
  ├─ PUT  /internal/exports/:job_id/status ← Python Worker 导出回调
  └─ GET  /photos                       → PostgreSQL（filtered by user_id）

Python Worker (内部服务)
  ├─ 监听 Redis Stream photogiraffe_tasks
  ├─ 下载 raw/ 原图 → EXIF 提取 → ICC → proxy (WebP 720p) + thumbnail (400px)
  ├─ 监听 photogiraffe_ai_tasks → AI 分析 → 回调
  ├─ 监听 photogiraffe_infer_tasks → 参数推断 → 回调
  └─ 监听 photogiraffe_export_tasks → 应用调整参数 → 导出 → 回调

MinIO (内部，9001 端口仅 console 外露)
  └─ bucket: photos
       ├─ raw/         原始文件
       ├─ proxy/       WebP 代理图 (720p, 色彩正确)
       └─ thumbnail/   WebP 缩略图 (400px)
```

---

## 四、目录结构

```
/root/code/Photogiraffe/
├── .env                    # 实际使用的环境变量（已 gitignore）
├── .env.example            # 环境变量模板（已提交）
├── README.md               # 用户向文档（已提交）
├── docker-compose.yml      # 6 服务编排
├── test_exif.py            # 独立 EXIF 测试脚本
├── frontend/               # Next.js 16 App Router
│   └── src/
│       ├── app/
│       │   ├── page.tsx                  # 画廊首页（CSR，authFetch）
│       │   ├── login/page.tsx            # 登录页
│       │   ├── register/page.tsx         # 注册页
│       │   ├── settings/page.tsx         # AI 配置页（SuperAdmin only）
│       │   ├── admin/page.tsx            # Admin Panel（SuperAdmin only）
│       │   ├── photo/[id]/page.tsx       # 照片详情（CSR）
│       │   ├── @modal/(.)photo/[id]/     # Parallel Route Modal（CSR）
│       │   └── api/                      # Next.js 代理路由（详见第九节）
│       ├── context/
│       │   └── AuthContext.tsx           # AuthProvider + useAuth + authFetch
│       └── components/
│           ├── AuthGuard.tsx             # 路由鉴权守卫
│           ├── ClientLayout.tsx          # AuthProvider + AppHeader + InnerLayout
│           ├── PhotoGrid.tsx             # 画廊网格
│           ├── PhotoDetail.tsx           # 照片详情 + EXIF + AI + WebGL
│           ├── UploadPanel.tsx           # 拖拽上传面板
│           └── AdjustPanel.tsx           # WebGL 色彩调整面板
├── go-core/
│   ├── main.go             # Fiber 路由 + 全部业务逻辑（943 行）
│   ├── auth/jwt.go         # JWT 工具函数
│   ├── models/models.go    # GORM 模型
│   ├── database/db.go      # PostgreSQL 连接 + AutoMigrate
│   ├── storage/minio.go    # MinIO 客户端封装
│   └── queue/redis.go      # Redis Streams 生产者封装
├── python-worker/
│   ├── main.py             # 任务消费主循环
│   └── requirements.txt
├── log/                    # 版本变更日志
└── outline/agent/          # 规划文档
```

---

## 五、环境变量总览

> 实际值来自 `/root/code/Photogiraffe/.env`（已 gitignore），模板见 `.env.example`

| 变量 | 当前值 | 用途 |
|------|--------|------|
| `DB_USER` | `postgres` | PostgreSQL 用户名 |
| `DB_PASSWORD` | `photogiraffe_db_pass` | PostgreSQL 密码 |
| `DB_NAME` | `photogiraffe` | 数据库名 |
| `REDIS_PASSWORD` | `photogiraffe_redis_pass` | Redis 认证 |
| `MINIO_USER` | `admin` | MinIO access key |
| `MINIO_PASSWORD` | `photogiraffe_minio_pass` | MinIO secret key |
| `INTERNAL_SECRET` | `d177805321d7f97e28e33f02ad1b02b174827feda71bfe5a` | Python Worker ↔ Go Core 内部通信 |
| `JWT_SECRET` | `photogiraffe_jwt_prod_secret_8f2a9d1c7b4e0f6a3d5c2b8e1f4a7d9` | JWT HS256 签名密钥 |
| `CORS_ALLOW_ORIGIN` | `http://localhost:3000` | Go Core CORS 白名单 |

> ADMIN_TOKEN 已废弃（v5.0 起），不再使用。

---

## 六、数据库 Schema

### users
| 列 | 类型 | 说明 |
|----|------|------|
| id | uint PK | GORM 内置 |
| username | string unique | — |
| email | string unique | — |
| password_hash | string | bcrypt cost=14 |
| role | string | SuperAdmin / StandardUser（第一个注册 → SuperAdmin）|

### photos
| 列 | 类型 | 说明 |
|----|------|------|
| id | uint PK | — |
| user_id | uint FK | 数据归属（RBAC 隔离依据）|
| original_filename | string | — |
| minio_path | string | raw/uuid.EXT |
| status | string | processing / completed / failed |
| uploaded_at | timestamp | — |
| ai_analysis | jsonb nullable | NULL = 未分析 |
| inferred_params | jsonb nullable | AI 推断的色彩调整参数 |

### exif_data
| 列 | 说明 |
|----|------|
| photo_id | FK |
| camera_model, lens_model, focal_length, aperture, shutter_speed, iso | 相机参数 |
| color_space | exifread 提取值 |
| icc_profile_name | Pillow ImageCms 完整 ICC 名 |
| gps_latitude, gps_longitude | GPS 坐标 |
| software, date_time_original | 软件信息 + 拍摄时间 |

### ai_configs
| 列 | 说明 |
|----|------|
| provider | openai / google / anthropic / zhipu / deepseek / minimax / openai_compatible |
| base_url | openai_compatible 时必填 |
| api_key | 明文存储 |
| model_name | — |

### feature_flags（6 条预置 seed 记录）
| feature_name | 默认 | 说明 |
|-------------|------|------|
| ai_analysis | false | AI 分析开关 |
| ai_infer_params | false | AI 参数推断开关 |
| export_engine | true | 导出引擎开关 |
| preset_management | true | 预设管理开关 |
| raw_decode | true | Wasm RAW 解码开关 |
| hdr_display | true | HDR 宽色域显示开关 |

### export_jobs
| 列 | 说明 |
|----|------|
| photo_id | FK |
| user_id | 归属 |
| status | pending / processing / completed / failed |
| export_options | jsonb（格式/质量/分辨率/调整参数）|
| output_path | MinIO 路径（完成后写入）|
| error_message | 失败原因 |
| completed_at | nullable timestamp |

### presets
| 列 | 说明 |
|----|------|
| user_id | 归属 |
| name | 预设名称 |
| description | 可选描述 |
| adjust_params | jsonb（色彩调整参数）|

### refresh_tokens
| 列 | 说明 |
|----|------|
| user_id | FK |
| token_hash | SHA-256 hex（uniqueIndex）|
| expires_at | 7 天后过期 |
| revoked | 是否已撤销 |

---

## 七、认证与权限系统

### JWT 设计
- **Access Token**：HS256，15 分钟，存于前端 React 内存（context state），不写 localStorage
- **Refresh Token**：32 字节 CSPRNG hex 字符串，SHA-256 hash 后存 DB，通过 httpOnly SameSite=Strict Cookie 传输，7 天有效，每次刷新时**轮换**（旧 token 撤销）
- **Session 恢复**：AuthContext 挂载时调用 POST /api/auth/refresh，从 Cookie 静默恢复会话

### RBAC 角色
| 角色 | 获取方式 | 权限 |
|------|---------|------|
| SuperAdmin | 系统第一个注册账户 | 全部操作 + AI 配置 + Admin Panel + Feature Flag 切换 |
| StandardUser | 后续注册 | 仅访问自己的照片/导出/预设 |

### Go Core 中间件
```go
requireJWT()                    // 验证 Bearer JWT，写入 c.Locals("userID"/"userRole"/"username")
requireRole(roles ...string)    // 必须在 requireJWT 之后，检查角色白名单
userIDFromLocals(c)             // 读取 c.Locals("userID") → uint，替代所有 UserID: 1 硬编码
requireInternalSecret(secret)  // 检查 X-Internal-Secret（Python Worker 内部回调专用）
```

### 前端 AuthContext（frontend/src/context/AuthContext.tsx）
- `useAuth()` 返回：`{ user, accessToken, isLoading, login, register, logout, authFetch }`
- `authFetch(url, options)`：注入 Authorization Bearer，401 时自动 refresh 重试一次，单例 refreshPromise 防并发竞态

---

## 八、全部 Go Core API 端点（main.go）

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /health | 无 | 健康检查 |
| POST | /api/auth/register | 无 | 注册（首个→SuperAdmin）|
| POST | /api/auth/login | 无 | 登录，Set-Cookie refresh token |
| POST | /api/auth/refresh | Cookie | 轮换颁发新 access token |
| POST | /api/auth/logout | JWT | 撤销 refresh token |
| GET | /api/auth/me | JWT | 当前用户信息 |
| POST | /upload | JWT | 上传文件 → MinIO + Redis Stream |
| GET | /photos | JWT | 当前用户照片列表 |
| GET | /photos/:id | JWT | 照片详情（需同属）|
| GET | /api/config/ai | JWT+SuperAdmin | 读取 AI 配置 |
| POST | /api/config/ai | JWT+SuperAdmin | 保存 AI 配置 |
| POST | /api/photos/:id/analyze | JWT（同属）| 触发 AI 分析 |
| POST | /api/photos/:id/infer-params | JWT（同属）| 触发 AI 参数推断 |
| POST | /api/photos/:id/export | JWT（同属）| 创建导出任务 |
| GET | /api/photos/:id/exports | JWT（同属）| 照片导出任务列表 |
| GET | /api/exports/:job_id | JWT（同属）| 导出任务状态 |
| GET | /api/exports/:job_id/download | JWT（同属）| 下载预签名 URL |
| POST | /api/presets | JWT | 创建预设 |
| GET | /api/presets | JWT | 当前用户预设列表 |
| DELETE | /api/presets/:id | JWT（同属）| 删除预设 |
| GET | /api/admin/flags | JWT+SuperAdmin | 列出所有 Feature Flag |
| PUT | /api/admin/flags/:name | JWT+SuperAdmin | 切换 Feature Flag |
| GET | /api/feature/:name | JWT | 查询单个 Flag 状态 |
| GET | /api/admin/users | JWT+SuperAdmin | 所有用户列表 |
| PUT | /internal/photos/:id/status | X-Internal-Secret | Python Worker 回调 |
| PUT | /internal/photos/:id/analysis | X-Internal-Secret | AI 分析结果回调 |
| PUT | /internal/photos/:id/inferred-params | X-Internal-Secret | 参数推断结果回调 |
| PUT | /internal/exports/:job_id/status | X-Internal-Secret | 导出状态回调 |

---

## 九、前端 Next.js 代理路由（frontend/src/app/api/）

所有路由均转发 `Authorization: Bearer <token>`

| 路由文件 | Method | 说明 |
|---------|--------|------|
| auth/register/route.ts | POST | 转发 Set-Cookie |
| auth/login/route.ts | POST | 转发 Set-Cookie |
| auth/refresh/route.ts | POST | 转发 Cookie + Set-Cookie |
| auth/logout/route.ts | POST | — |
| auth/me/route.ts | GET | — |
| photos/route.ts | GET | — |
| photos/[id]/route.ts | GET | — |
| photos/[id]/analyze/route.ts | POST | — |
| photos/[id]/infer-params/route.ts | POST | — |
| photos/[id]/export/route.ts | POST | — |
| exports/[job_id]/route.ts | GET | — |
| exports/[job_id]/download/route.ts | GET | — |
| presets/route.ts | GET/POST | — |
| presets/[id]/route.ts | DELETE | — |
| config/ai/route.ts | GET/POST | — |
| upload/route.ts | POST | — |
| admin/flags/route.ts | GET | — |
| admin/flags/[name]/route.ts | PUT | — |
| admin/users/route.ts | GET | — |
| image/route.ts | GET | MinIO presigned URL 代理 |

---

## 十、版本发布历史（含 commit）

| 版本 | Commit | 核心内容 |
|------|--------|---------|
| v1.0–v1.4 | — | Docker 基础设施 → PostgreSQL → 上传链路 → Python 处理 → UI |
| v2.0–v2.4 | — | EXIF 深度解析 → 动画详情页 → AI 分析 → 安全加固 → 拖拽上传 |
| v3.0 | f6c4c19 | ICC Profile 代理 + 色彩空间徽章 |
| v3.1 | 9c21af4 | Wasm LibRaw 浏览器端 RAW 解码 |
| v3.2 | c12ee87 | WebGL2 实时色彩调整 + AdjustPanel |
| v3.3 | b3b8b04 | 宽色域/HDR 显示适配 |
| v4.0 | b03dbe2 | 导出引擎（Go+Python+前端 ExportPanel）|
| v4.1 | 01fea64 | 预设管理（保存/应用/删除）|
| v4.2 | a568171 | AI 参数推断（LLM 推荐调整值）|
| v5.0 | d00867d | JWT 认证体系（33 文件，+1339 行）|
| v5.1 | 798db0c | RBAC 多用户数据隔离 |
| v5.2 | e152e83 | Feature Flag API + Admin Panel UI |
| docs | 8a8f5d9 | README.md + .env.example |

---

## 十一、规划文档（outline/agent/）编号规范

| 编号范围 | 内容 |
|---------|------|
| 03 | 整体架构蓝图（不修改）|
| 04-08 | Phase 1 各步骤 |
| 09 | Phase 2-5 高层 Roadmap |
| 10-15 | Phase 2 各步骤 + 安全加固 |
| 16-20 | Phase 3 Roadmap + 4 步骤 |
| 21-24 | Phase 4 Roadmap + 3 步骤 |
| 25-28 | Phase 5 Roadmap + 3 步骤 |
| **29+** | **Phase 6（待编写）** |

**命名规则**：序号连续递增，`{序号}_Phase{N}_Step{X}_Plan.md` 或 `{序号}_Phase{N}_Roadmap.md`

---

## 十二、版本日志（log/）命名规范

```
log/{YYYYMMDD}_{HHMMSS}_{版本号}.md
例：log/20260222_160000_v6.0.md
```

**格式模板**：
```markdown
# Photogiraffe {版本号} 变更日志

## 版本信息
- 版本：{N}
- 日期：{YYYY-MM-DD}
- 对应 Phase：Phase {N} Step {X}

## 变更内容

### 新增
### 修改
### 修复

## 修改的文件
| 文件 | 变更类型 | 说明 |

## 验证结果

## 下一步计划
```

---

## 十三、开发流程规范

### 每次开发前必做

1. 确认 `git log --oneline -3` 确认 HEAD
2. 阅读本 HANDOFF.md 第十五节（当前状态）
3. `docker compose ps` 确认所有服务 healthy

### 每个版本开发流程

```
1. 读对应 outline step plan 文档，明确目标
2. 如不存在 plan 文档，先编写 outline/agent/{序号}_Phase{N}_Step{X}_Plan.md
3. 实现代码改动
4. docker compose build --no-cache {services} && docker compose up -d
5. 按"十四节"验证测试
6. 写 log/{date}_{time}_{version}.md
7. git add -A && git commit -m "feat(vN.M): 简短描述"
8. 更新本文档十节版本历史 + 十五节当前状态
```

### 禁止事项

- 不得重新引入 `ADMIN_TOKEN` 认证逻辑（已废弃）
- 不得在 Go Core 中使用 `UserID: 1` 硬编码（必须用 `userIDFromLocals(c)`）
- 不得在前端使用 SSR 模式访问需要 JWT 的 API（全部用 CSR + authFetch）

---

## 十四、验证测试命令

### 服务管理

```bash
docker compose ps
docker compose logs -f go-core
docker compose logs -f python-worker
docker compose logs -f frontend
docker compose build --no-cache go-core && docker compose up -d go-core
```

### 端到端认证测试

```bash
# 注册（首个用户 → SuperAdmin）
curl -s -c /tmp/pg_cookies.txt -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@example.com","password":"admin123"}' | jq .

# 登录，提取 access_token
ACCESS=$(curl -s -c /tmp/pg_cookies.txt -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .access_token)

# 上传文件
curl -X POST http://localhost:8080/upload \
  -H "Authorization: Bearer $ACCESS" \
  -F "image=@/root/picture/A6704325.HIF"

# 列出照片
curl -s http://localhost:8080/photos -H "Authorization: Bearer $ACCESS" | jq .

# 刷新 token（使用 httpOnly Cookie）
curl -s -b /tmp/pg_cookies.txt -c /tmp/pg_cookies.txt \
  -X POST http://localhost:8080/api/auth/refresh | jq .

# 获取 Feature Flags（SuperAdmin）
curl -s http://localhost:8080/api/admin/flags -H "Authorization: Bearer $ACCESS" | jq .

# 切换一个 Flag
curl -s -X PUT http://localhost:8080/api/admin/flags/ai_analysis \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"is_enabled":true}' | jq .
```

### 数据库检查

```bash
# 用户表
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe \
  -c "SELECT id, username, email, role FROM users;"

# 照片（含 user_id）
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe \
  -c "SELECT id, user_id, status, original_filename FROM photos ORDER BY id DESC LIMIT 5;"

# EXIF
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe \
  -c "SELECT photo_id, camera_model, icc_profile_name FROM exif_data ORDER BY id DESC LIMIT 3;"

# Feature Flags
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe \
  -c "SELECT feature_name, is_enabled FROM feature_flags;"

# 手动提升 SuperAdmin（应急）
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe \
  -c "UPDATE users SET role='SuperAdmin' WHERE username='admin';"
```

### 前端页面验证

- 画廊首页：http://localhost:3000
- 登录：http://localhost:3000/login
- 注册：http://localhost:3000/register
- AI 设置（SuperAdmin）：http://localhost:3000/settings
- Admin Panel（SuperAdmin）：http://localhost:3000/admin

---

## 十五、当前状态 & Phase 6 工作方向

**HEAD**：`8a8f5d9` docs: add user-facing README and .env.example

**Phase 5 已完整交付**：
- v5.0 `d00867d`：JWT 认证体系（HS256 + httpOnly Cookie Refresh Token Rotation）
- v5.1 `798db0c`：多用户 RBAC + user_id 数据隔离 + 归属检查
- v5.2 `e152e83`：Feature Flag 管理 API + Admin Panel UI（Feature Flags + 用户列表）

**Phase 6 尚未开始**，候选方向：
1. **性能与体验**：分页、搜索/过滤、LazyLoad 骨架屏优化
2. **PWA / 移动端**：Service Worker 离线支持、移动端响应式完善
3. **相册分享**：生成公开预览链接（无需登录可访问）
4. **批量操作**：批量删除 / 批量导出 / 批量标签
5. **生产部署加固**：Nginx 反向代理 + HTTPS + Rate Limiting + 注册邀请码

**Phase 6 开始步骤**：
1. 确认具体方向（读 09_Phase2_to_5_Roadmap.md 或询问用户）
2. 编写 `outline/agent/29_Phase6_Roadmap.md`
3. 按规范逐步实现 → build → test → log → commit

---

*文档维护规范：每次 commit 后同步更新"十节版本历史"和"十五节当前状态"。*
