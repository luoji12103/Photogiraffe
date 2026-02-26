# Photogiraffe — 开发工作交接文档

> **本文最后更新**：2026-02-26（Phase 17 完成）
> **当前已交付至**：v17.4（Phase 17 感知哈希去重）
> **下一步工作**：Phase 18（导出历史页 / AI 自动标签）
> **仓库**：`luoji12103/Photogiraffe`，分支 `s4.6full-stack`
> **最新 commit**：`ae3876a` feat: Phase 17 — perceptual hash deduplication (v17.1-v17.4)

---

## 一、项目简介

Photogiraffe 是面向摄影师的**高画质个人影像管理平台**，核心特性：

- 支持 RAW（ARW/CR2/CR3/NEF 等）、HEIF（HIF）、JPEG 等格式上传
- 自动提取深度 EXIF 元数据（含 ICC Profile、GPS、相机/镜头）
- 浏览器端 WebGL2 实时色彩调整（曝光/对比度/饱和度/色温/HSL 等）
- 浏览器端 Wasm LibRaw 解码 RAW 文件（Progressive 渐进加载）
- 多提供商 AI 摄影艺术分析 + AI 推断最佳色彩调整参数
- 导出引擎：应用调整后导出 JPEG/PNG/WebP/TIFF，支持水印叠加
- 预设管理：保存/应用/删除/上传下载色彩调整方案，支持 .xmp/.lrtemplate 解析
- 相册系统：创建相册、添加照片、相册分享（公开预览链接）
- 照片分享：单张照片生成公开分享链接
- 公开作品集：`/p/:username` 展示用户公开照片
- 多用户 JWT 认证（SuperAdmin/StandardUser 角色）+ 数据隔离
- Feature Flag 管理后台（动态开关功能模块）
- SSE 实时事件推送（任务完成通知）
- SuperAdmin 用户管理（查看统计、修改角色、删除用户、查看用户照片）
- 存储后端配置（MinIO / S3 兼容 / WebDAV 可切换）

---

## 二、技术栈

| 层 | 技术 | 版本/备注 |
|----|------|---------|
| 前端框架 | Next.js App Router | 16.x，TypeScript，Tailwind CSS v4 |
| 前端动画 | Framer Motion | Shared Layout Animation |
| 图标 | lucide-react | — |
| 图像渲染 | WebGL2 + Wasm LibRaw | libraw-wasm npm 包 |
| 后端 | Go + Fiber v2 | GORM，PostgreSQL 驱动，bcrypt，JWT HS256 |
| 数据库 | PostgreSQL 15 | GORM AutoMigrate 管理 schema |
| 缓存/队列 | Redis 7 | Redis Streams（Go → Python 任务分发）|
| 对象存储 | MinIO | bucket `photos`，私有访问 |
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
  ├─ GET  /api/events/stream           → SSE 流式代理 → Go Core /api/events/stream
  ├─ POST /api/auth/*                  → 转发（含 Cookie）→ Go Core /api/auth/*
  ├─ GET/PUT /api/admin/*              → 转发 Authorization → Go Core /api/admin/*
  └─ (其他 /api/* 路由均为 Go Core 代理，见第九节)

Go Core (:8080，绑定 127.0.0.1)
  │                              75 个路由，222 个 Fiber handlers
  ├─ POST /upload                      → MinIO (raw/) + Redis Stream photogiraffe_tasks
  ├─ 对外: /photos, /api/*, /share/*, /public/*
  ├─ PUT  /internal/*                  ← Python Worker 回调（需 X-Internal-Secret）
  └─ GET  /api/events/stream           → SSE（token query param 鉴权）

Python Worker (内部服务)
  ├─ 监听 Redis Stream photogiraffe_tasks → EXIF + proxy/thumbnail → 回调
  ├─ 监听 photogiraffe_ai_tasks → AI 分析 → 回调
  ├─ 监听 photogiraffe_infer_tasks → 参数推断 → 回调
  └─ 监听 photogiraffe_export_tasks → 导出 + 叠加水印 → 回调

MinIO (内部，9001 仅 console)
  └─ bucket: photos
       ├─ raw/          原始文件
       ├─ proxy/        WebP 代理图 (720p)
       ├─ thumbnail/    WebP 缩略图 (400px)
       ├─ exports/      导出成品
       ├─ profiles/     头像和签名图片
       └─ presets/      预设文件
```

---

## 四、目录结构

```
/root/code/Photogiraffe/
├── .env                    # 实际环境变量（已 gitignore）
├── .env.example            # 模板（已提交）
├── docker-compose.yml      # 6 服务编排
├── tests/
│   └── integration_test.py # 集成测试（128 项，全部通过）
├── frontend/src/
│   ├── app/
│   │   ├── page.tsx                  # 画廊首页（排序 + 布局切换）
│   │   ├── login/ / register/        # 认证页
│   │   ├── settings/page.tsx         # 设置（4 标签：通用/AI API/存储/账号）
│   │   ├── admin/page.tsx            # Admin Panel（4 标签：统计/功能开关/用户/邀请码）
│   │   ├── photo/[id]/page.tsx       # 照片详情（浏览/编辑分离）
│   │   ├── @modal/(.)photo/[id]/     # Parallel Route Modal
│   │   ├── albums/[id]/page.tsx      # 相册详情
│   │   ├── compare/page.tsx          # 照片对比
│   │   ├── dashboard/page.tsx        # 仪表盘
│   │   ├── search/page.tsx           # 高级搜索
│   │   ├── p/[username]/page.tsx     # 公开作品集
│   │   ├── share/                    # 分享链接页（照片/相册）
│   │   └── api/                      # Next.js 代理路由（见第九节）
│   ├── context/AuthContext.tsx       # JWT + refresh token 会话管理
│   └── components/
│       ├── AuthGuard.tsx             # 路由鉴权守卫
│       ├── ClientLayout.tsx          # 全局布局 + 导航
│       ├── PhotoGrid.tsx             # 网格 + 瀑布流 Masonry 布局
│       ├── PhotoDetail.tsx           # 详情（浏览/编辑模式 + WebGL + AI）
│       ├── UploadPanel.tsx           # 拖拽上传
│       ├── AdjustPanel.tsx           # WebGL 色彩调整
│       ├── PresetPanel.tsx           # 预设管理 + XMP 解析上传
│       ├── ExportPanel.tsx           # 导出 + 水印叠加
│       ├── CompareView.tsx           # 并排对比
│       └── PhotoMapLeaflet.tsx       # 地图视图
├── go-core/
│   ├── main.go             # Fiber 路由 + 全部业务逻辑（~2924 行，75 路由）
│   ├── auth/jwt.go         # JWT GenerateAccessToken / ValidateAccessToken
│   ├── models/models.go    # 14 个 GORM 模型
│   ├── database/db.go      # PostgreSQL 连接 + AutoMigrate + StorageConfig 初始化
│   ├── storage/minio.go    # MinIO 客户端封装
│   └── queue/redis.go      # Redis Streams 生产者封装
├── python-worker/
│   ├── main.py             # 任务消费主循环
│   └── requirements.txt
└── outline/agent/          # 规划文档（见第十一节）
```

---

## 五、环境变量

| 变量 | 用途 |
|------|------|
| `DB_USER` | PostgreSQL 用户名 |
| `DB_PASSWORD` | PostgreSQL 密码 |
| `DB_NAME` | 数据库名 |
| `REDIS_PASSWORD` | Redis 认证 |
| `MINIO_USER` | MinIO access key |
| `MINIO_PASSWORD` | MinIO secret key |
| `INTERNAL_SECRET` | Worker ↔ Go Core 内部通信密钥 |
| `JWT_SECRET` | JWT HS256 签名密钥 |
| `CORS_ALLOW_ORIGIN` | Go Core CORS 白名单（通常为 `http://localhost:3000`）|

---

## 六、数据库 Schema（14 个 GORM 模型）

### users
| 列 | 类型 | 说明 |
|----|------|------|
| id | uint PK | 内部主键（不对外暴露）|
| public_id | string uniqueIndex | UUID v4，BeforeCreate 自动生成，JWT uid 字段使用此值 |
| username | string unique | — |
| email | string unique | — |
| password_hash | string | bcrypt cost=14 |
| role | string | `SuperAdmin` / `StandardUser`（第一个注册 → SuperAdmin）|

### photos
| 列 | 类型 | 说明 |
|----|------|------|
| user_id | uint FK | 数据归属 |
| original_filename | string | — |
| minio_path | string | raw/uuid.EXT |
| status | string | processing / completed / failed |
| is_public | bool | 公开作品集可见 |
| description | text | 说明文字 |
| tags | *string (jsonb) | JSON 字符串数组，**指针类型**，NULL 合法 |
| ai_analysis | *string (jsonb) | NULL 直到 AI 分析完成 |
| inferred_params | *string (jsonb) | AI 推断色彩调整参数 |
| applied_preset_id | *uint | 最后应用的预设 ID |

### exif_data
camera_model, lens_model, focal_length, aperture, shutter_speed, iso, color_space, icc_profile_name, gps_latitude, gps_longitude, software, date_time_original

**Phase 13 新增字段：**
- `copyright string` — dc:rights / EXIF Copyright（导出时写入 IFD0:Copyright）
- `creator string` — dc:creator / EXIF Artist（导出时写入 IFD0:Artist）

### presets
user_id, name, description, adjust_params (jsonb), platforms (jsonb), file_path

### albums / album_photos（多对多联表）
albums: user_id, name, description, cover_photo_id, share_token

### user_profiles（user_id 1:1）
bio, avatar_path, signature_path, website, location

### 其他模型
- **feature_flags**：feature_name, is_enabled, description（6 条 seed 数据）
- **ai_configs**：provider, base_url, api_key, model_name
- **export_jobs**：photo_id, user_id, status, export_options (jsonb), output_path
- **refresh_tokens**：user_id, token_hash (SHA-256), expires_at, revoked
- **share_links**：photo_id, user_id, token, expires_at, is_revoked
- **invite_codes**：code, created_by, used_by, used_at, expires_at
- **storage_configs**（id=1 单行）：backend (minio|s3|webdav), endpoint, bucket, access_key, secret_key, root_path, use_ssl, region

---

## 七、认证与权限系统

### JWT 设计
- **Access Token**：HS256，15 分钟，存于前端 React context（不写 localStorage）
- **Claims.UserID**：`user.PublicID`（UUID v4），**绝不使用整型 PK**
- **Refresh Token**：32 字节 CSPRNG hex，SHA-256 hash 后入库，httpOnly SameSite=Strict Cookie，7 天，每次轮换
- **requireJWT 实现**：验证 token → 从 DB 用 `public_id` 解析出内部整型 id → `Locals("userID", row.ID)` + `Locals("userPublicID", claims.UserID)`

### RBAC 角色
| 角色 | 获取 | 权限 |
|------|------|------|
| SuperAdmin | 系统第一个注册账户 或 管理员手动提升 | 全部操作 + Admin Panel |
| StandardUser | 后续注册（邀请码或开放注册）| 仅自己的数据 |

### Go Core 关键函数
```go
requireJWT()                       // 验证 Bearer JWT → 解析 public_id → DB 查 uint id
requireRole(roles ...string)       // 检查角色白名单（需在 requireJWT 之后）
userIDFromLocals(c) uint           // 读取 c.Locals("userID") → uint 内部 PK
publicIDFromLocals(c) string       // 读取 c.Locals("userPublicID") → UUID string
requireInternalSecret(secret)     // X-Internal-Secret 头校验（Worker 回调专用）
```

### 前端 AuthContext
`useAuth()` → `{ user, accessToken, isLoading, login, register, logout, authFetch }`
`authFetch`：注入 Bearer，401 时静默 refresh 重试一次，单例 refreshPromise 防并发

---

## 八、完整 Go Core API 端点（75 个路由）

### 认证
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /health | 无 | 健康检查 |
| POST | /api/auth/register | 无 | 注册（首个→SuperAdmin；支持邀请码）|
| POST | /api/auth/login | 无 | 登录（IP 限流）|
| POST | /api/auth/refresh | Cookie | 轮换 refresh token |
| POST | /api/auth/logout | JWT | 撤销 refresh token |
| GET | /api/auth/me | JWT | 当前用户信息（返回 public_id 作为 id）|

### 照片
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | /upload | JWT | 上传文件 → MinIO raw/ + Redis Stream |
| GET | /photos | JWT | 照片列表（分页，?sort=date_desc\|date_asc\|filename\|camera\|iso）|
| GET | /photos/:id | JWT | 照片详情（含 UserID 字段）|
| GET | /api/photos/map | JWT | 地图 GPS 数据点 |
| PUT | /api/photos/:id/visibility | JWT（同属）| 公开/私密切换 |
| PUT | /api/photos/:id/description | JWT（同属）| 更新说明和标签 |
| POST | /api/photos/bulk-delete | JWT | 批量删除 |
| POST | /api/photos/bulk-album | JWT | 批量加入相册 |
| POST | /api/photos/batch-delete | JWT | 旧版批量删除（兼容）|
| POST | /api/photos/batch-export | JWT | 批量导出 |
| GET | /api/photos/search | JWT | 高级搜索（camera/lens/ISO/日期/GPS/关键词）|

### AI / 分析
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | /api/photos/:id/analyze | JWT（同属）| 触发 AI 艺术分析 |
| POST | /api/photos/:id/infer-params | JWT（同属）| 触发 AI 色彩参数推断 |
| GET | /api/config/ai | JWT+SuperAdmin | 读取 AI 配置 |
| POST | /api/config/ai | JWT+SuperAdmin | 保存 AI 配置 |

### 导出
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | /api/photos/:id/export | JWT（同属）| 创建导出任务 |
| GET | /api/photos/:id/exports | JWT（同属）| 照片导出任务列表 |
| GET | /api/exports/:job_id | JWT（同属）| 任务状态 |
| GET | /api/exports/:job_id/download | JWT（同属）| 下载预签名 URL |

### 预设
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | /api/presets | JWT | 创建预设 |
| GET | /api/presets | JWT | 预设列表 |
| DELETE | /api/presets/:id | JWT（同属）| 删除 |
| PUT | /api/presets/:id | JWT（同属）| 更新 |
| POST | /api/presets/:id/apply/:photo_id | JWT | 应用预设到照片 |
| GET | /api/photos/:id/preset | JWT | 查看已应用预设 |
| POST | /api/presets/:id/file | JWT（同属）| 上传预设文件到 MinIO |
| GET | /api/presets/:id/file | JWT（同属）| 下载预设文件 |
| POST | /api/presets/parse-xmp | JWT | 解析 .xmp/.lrtemplate → AdjustParams JSON |
| GET | /api/photos/:id/preset-preview | JWT（同属）| 返回 InferredParams + EXIF 摘要 |

### 相册
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | /api/albums | JWT | 创建相册 |
| GET | /api/albums | JWT | 相册列表 |
| GET | /api/albums/:id | JWT | 相册详情 |
| PUT | /api/albums/:id | JWT（同属）| 更新相册 |
| DELETE | /api/albums/:id | JWT（同属）| 删除相册 |
| POST | /api/albums/:id/photos | JWT（同属）| 添加照片 |
| DELETE | /api/albums/:id/photos/:photo_id | JWT（同属）| 移除照片 |
| POST | /api/albums/:id/share | JWT（同属）| 创建相册分享链接 |
| DELETE | /api/albums/:id/share | JWT（同属）| 撤销相册分享 |
| GET | /share/album/:token | 无 | 公开相册预览页 |

### 照片分享
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | /api/photos/:id/share | JWT（同属）| 创建分享链接 |
| GET | /api/photos/:id/share | JWT（同属）| 查看分享链接 |
| DELETE | /api/photos/:id/share/:token | JWT（同属）| 撤销分享 |
| GET | /share/:token | 无 | 公开照片访问 |

### 用户资料
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /api/profile | JWT | 当前用户资料 |
| PUT | /api/profile | JWT | 更新 bio/website/location |
| POST | /api/profile/avatar | JWT | 上传头像 |
| POST | /api/profile/signature | JWT | 上传签名图 |
| GET | /api/profile/overlays | JWT | 导出水印可用性检查 |
| GET | /public/profile/:username | 无 | 公开作品集 |

### Admin（SuperAdmin 专属）
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /api/admin/flags | JWT+SA | Feature Flag 列表 |
| PUT | /api/admin/flags/:name | JWT+SA | 切换 Flag |
| GET | /api/admin/users | JWT+SA | 用户列表（含 photo_count, public_id）|
| GET | /api/admin/users/:id/photos | JWT+SA | 指定用户照片 |
| PUT | /api/admin/users/:id/role | JWT+SA | 修改角色（不能自改）|
| DELETE | /api/admin/users/:id | JWT+SA | 删除用户（级联，不能自删）|
| POST | /api/admin/invite-codes | JWT+SA | 生成邀请码 |
| GET | /api/admin/invite-codes | JWT+SA | 邀请码列表 |
| DELETE | /api/admin/invite-codes/:id | JWT+SA | 删除邀请码 |
| GET | /api/admin/stats | JWT+SA | 统计摘要（用户/照片/相册/预设 + Top 10 用户）|
| GET | /api/admin/storage | JWT+SA | 存储配置（secret_key 已遮码）|
| PUT | /api/admin/storage | JWT+SA | 更新存储配置 |
| POST | /api/admin/storage/test | JWT+SA | 测试存储连通性 |

### 其他
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /api/stats | JWT | 当前用户仪表盘统计 |
| GET | /api/feature/:name | JWT | 查询单个 Flag 状态 |
| GET | /api/events/stream | ?token= | SSE 实时事件推送（token query param）|
| PUT | /internal/photos/:id/status | Secret | Worker 回调 |
| PUT | /internal/photos/:id/analysis | Secret | AI 分析结果回调 |
| PUT | /internal/photos/:id/inferred-params | Secret | 参数推断结果回调 |
| PUT | /internal/exports/:job_id/status | Secret | 导出状态回调 |
| GET | /api/photos/:id/iptc | JWT（同属/SA）| 读取 IPTC 元数据（copyright, creator）|
| PUT | /api/photos/:id/iptc | JWT（同属）| 更新 copyright + creator |
| GET | /internal/photos/:id/iptc | Secret | Worker 读取 IPTC（无 JWT）|

---

## 九、前端 Next.js 代理路由（frontend/src/app/api/）

| 目录 | 说明 |
|------|------|
| auth/ | register, login, refresh, logout, me |
| photos/ + photos/[id]/ | CRUD + analyze, infer-params, export, visibility, description, share, preset |
| photos/bulk-delete, bulk-album | 批量操作 |
| photos/search | 高级搜索 |
| exports/[job_id]/, exports/[job_id]/download | 导出任务 |
| presets/ + presets/[id]/ + presets/parse-xmp | 预设管理 |
| config/ai | AI 配置 |
| upload | 上传（服务端注入 Bearer token）|
| admin/{flags,users,invite-codes,stats,storage} | Admin Panel |
| albums/ + albums/[id]/ | 相册管理 |
| profile/ + profile/avatar + profile/signature | 用户资料 |
| public/profile/[username] | 公开作品集 |
| share/ + share/[token] + share/album/[token] | 分享链接 |
| stats | 仪表盘统计 |
| feature/[name] | Feature Flag 查询 |
| **events/stream** | **SSE 流式代理**（流式转发，不缓冲）|
| image | MinIO presigned URL 代理 |
| photos/[id]/iptc | GET/PUT IPTC 元数据代理（Phase 13）|
| albums/[id]/export | POST 创建相册导出任务 / GET 导出历史（Phase 14）|

---

## 十、版本发布历史

| 版本 | Commit | 核心内容 |
|------|--------|---------|
| v1.0–v5.2 | `8a8f5d9` | Docker → EXIF → WebGL → 导出 → 预设 → JWT/RBAC → Feature Flag |
| v6 系列 | — | 分享链接、邀请码、批量操作（Phase 6）|
| v7.3–v7.5 | — | 相册 CRUD + 分享、用户资料（头像/签名）、预设增强（平台/文件）|
| v8.1 | — | 仪表盘统计 |
| v8.3 | — | 高级搜索（多维过滤）|
| v8.5 | — | SSE 实时通知 |
| v9.1 | — | 导出水印叠加（头像/签名/EXIF 文字/描述）|
| v9.2 | — | Photo.IsPublic + Photo.Tags |
| v9.3 | — | 批量删除 / 批量加相册 |
| v9.4 | — | 照片描述与标签编辑 |
| v9.5 | `01f8f0d` | 公开作品集 /p/:username |
| v9.x fix | `9331fbd` | gofmt 格式化 |
| **v10.1** | `acd3a7d` | Admin 统计摘要 + 用户管理（角色/删除/照片）|
| **v10.2** | `acd3a7d` | XMP/LrTemplate 解析 → AdjustParams、preset-preview |
| **v10.3** | `acd3a7d` | 照片列表 5 种排序 + Masonry 瀑布流布局 |
| **v10.4** | `acd3a7d` | 详情页浏览/编辑模式分离 |
| **v10.5** | `acd3a7d` | 设置页 4 标签 + StorageConfig 后端配置 |
| fix | `c125c3a` | Tags 字段改为 `*string` 修复 jsonb NULL 约束 |
| fix | `57f2ffb` | page.tsx photos 数组提取 + SSE 代理路由 |
| **v11.1** | `f025a92` | ThemeContext 主题系统（light/dark/system）、CSS design tokens、layout.tsx FOUC 防闪 |
| **v11.2** | `f025a92` | ClientLayout.tsx 重写：可折叠侧边栏（240/64px）、移动端底部导航、framer-motion 活跃指示、主题切换器 |
| **v11.3** | `f025a92` | PhotoGrid SkeletonCard、画廊空状态 EmptyGallery、DashboardSkeleton、Albums 骨架屏、Toast 升级 |
| **v11.4** | `f025a92` | PhotoGrid stagger 卡片入场动画、albums AnimatePresence、login/register framer-motion、全体 pg-* token 适配 |
| **v11.5** | `dd2ad77` | 无限滚动分页：IntersectionObserver + GET /photos?page=&limit= + 滚动位置恢复 |
| **v12.1** | `8d9c02e` | 修复 2 项 pre-existing 测试失败 → **129/129**（preset ID 顶层暴露 + PublicPhoto is_public 字段）|
| **v12.2–12.4** | `a41027b` | profile/map/compare 三页全面 pg-* 主题适配 |
| **v13.1–13.5** | `ea91f92` | IPTC/XMP 元数据：模型扩展 + API 3 端点 + Worker XMP 提取/IPTC 写入 + IPTCPanel 前端组件 |
| **v14.1–14.6** | `3f091da` | 相册批量导出：ExportJob 扩展 + 3 个相册端点 + Worker ZIP/PDF + 冲印裁切 + 前端导出面板 |
| **v15.1–15.4** | `d9a21c0` | 简约边框渲染：/internal/photos/:id/meta + Worker frame engine（8 函数，3 主题，9 比例，动态布局）+ ExportPanel 边框 UI |
| fix | `4d652cc` | 导出 401 修复：process_export_task → _fetch_photo_meta()（X-Internal-Secret），meta 端点补充 minio_path |
| **v16.1–16.4** | `b4cfb2a` | 主色调提取：DominantColors jsonb + Worker PIL.quantize + _color_bucket 11桶 HSL分类 + PUT /internal/photos/:id/dominant-colors + GET /photos color_bucket 筛选 + 前端色块 UI |
| AI 分析同结果 fix | `77fab1f` | AI_ANALYSIS_PROMPT placeholder bug 修复 + kimi PROVIDER_BASE_URLS 修复 + EN/ZH 提示词选择 |
| **v17.1–17.4** | `ae3876a` | 感知哈希去重：PHash varchar(16) + math/bits Hamming + Union-Find + PUT /internal/photos/:id/phash + GET /api/photos/duplicates + imagehash worker步骤 + 前端去重页面 + 148/148 测试 |

---

## 十一、规划文档（outline/agent/）

| 编号 | 内容 |
|------|------|
| 03–08 | 整体架构蓝图 + Phase 1 步骤 |
| 09–14 | Phase 2–5 Roadmap + 步骤 + 安全加固 |
| 15–28 | Phase 3–5 Roadmap + 步骤 |
| 29–32 | Phase 6–9（已完成）|
| **33** | **Phase 10 Roadmap（已完成）** |
| **34** | **Phase 11 Roadmap（已完成）** |
| **35** | **Phase 12 Roadmap（已完成）** |
| **36** | **Phase 13 Roadmap（已完成）** |
| **37** | **Phase 14 Roadmap（已完成）** |
| **38** | **Phase 15 Roadmap（已完成）** |
| **39** | **Phase 17 Roadmap（已完成）** (`outline/agent/39_Phase17_Roadmap.md`，含 Phase 16+17 交付记录）|

---

## 十二、开发流程规范

### 每次开发前必做
1. `git log --oneline -5` 确认 HEAD
2. 阅读本 HANDOFF.md 第十五节
3. `docker compose ps` 确认服务正常

### 每个版本开发流程
```
1. 读 outline plan 文档明确目标
2. 如无 plan，先写 outline/agent/{序号}_PhaseN_StepX_Plan.md
3. 实现代码改动
4. docker compose up -d --build {services}
5. python3 tests/integration_test.py 验证全部通过
6. git add -A && git commit -m "vN.M: 简短描述"
7. 更新本文档第十节和第十五节
```

### 关键约束（禁止事项）
- **禁止** `ADMIN_TOKEN` 认证逻辑（已废弃）
- **禁止** Go Core 中 `UserID: 1` 硬编码（必须用 `userIDFromLocals(c)`）
- **禁止** `auth.GenerateAccessToken(user.ID, ...)` → 必须用 `user.PublicID`（字符串 UUID）
- **禁止** 前端 SSR 模式访问需要 JWT 的 API（全部用 CSR + authFetch）
- **注意** `Tags` 字段为 `*string` 指针——不能赋 `""` 空字符串，应赋 `nil` 或合法 JSON

---

## 十三、验证测试命令

```bash
# 运行集成测试（需 Go Core 已启动于 8080）
python3 tests/integration_test.py

# 重建服务
docker compose up -d --build go-core
docker compose up -d --build frontend

# 查看日志
docker compose logs -f go-core
docker compose logs -f frontend

# 数据库检查
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe \
  -c "SELECT id, public_id, username, role FROM users;"

# 手动提升 SuperAdmin
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe \
  -c "UPDATE users SET role='SuperAdmin' WHERE username='your_username';"

# 前端页面
# http://localhost:3000         — 画廊（排序/瀑布流）
# http://localhost:3000/admin   — Admin Panel（SuperAdmin）
# http://localhost:3000/settings — 设置（4 标签）
```

---

## 十四、已知问题 / 注意事项

1. **XMP 解析**：使用正则 `(?:crs:)(\w+)=["'](-?[\d.]+)["']` 而非 `encoding/xml`（Go XML 无法解析 XMP 命名空间）
2. **SSE 代理**：`frontend/src/app/api/events/stream/route.ts` 必须直流转发 response body，不可缓冲
3. **排序 JOIN**：`GET /photos?sort=camera` 会 `LEFT JOIN exif_data`，无 EXIF 的照片排在最后
4. **UserID 在 JWT**：`GenerateAccessToken` 参数为 `user.PublicID`（string UUID），不是 `user.ID`（uint）

---

## 十五、当前状态 & Phase 18 方向

**HEAD**：`ae3876a` Phase 17 感知哈希去重（v17.1-v17.4）
**集成测试**：**`148/148 PASS`** ✅
**全部服务**：正常运行于 Docker Compose

### 最近完成阶段摘要

| 阶段 | Commit | 状态 | 内容摘要 |
|------|--------|------|----------|
| Phase 15 v15.1–15.4 | `d9a21c0` | ✅ | /internal/photos/:id/meta + frame engine（8 函数，3 主题，9 比例）+ ExportPanel 边框 UI |
| Phase 16 v16.1–16.4 | `b4cfb2a` | ✅ | DominantColors jsonb + PIL.quantize + _color_bucket 11桶 + 颜色筛选 API + 前端色块 UI |
| AI 分析 fix | `77fab1f` | ✅ | AI_ANALYSIS_PROMPT placeholder bug 修复 + kimi 修复 + EN/ZH 提示词语言选择 |
| Phase 17 v17.1–17.4 | `ae3876a` | ✅ | PHash varchar(16) + Hamming/Union-Find + /phash 端点 + /duplicates API + Worker imagehash + 前端去重页 |

### Phase 17 完整交付清单

| 子版本 | 状态 | 内容摘要 |
|--------|------|---------|
| v17.1 | ✅ | models.go PHash *string gorm:"type:varchar(16)" + main.go math/bits + PUT /internal/photos/:id/phash + GET /api/photos/duplicates（Union-Find Hamming≤10）|
| v17.2 | ✅ | requirements.txt imagehash + main.py import imagehash + step 6 phash 计算推送 |
| v17.3 | ✅ | frontend/src/app/api/photos/duplicates/route.ts 代理 + duplicates/page.tsx 去重页面 + ClientLayout.tsx Copy 导航项 |
| v17.4 | ✅ | tests/integration_test.py test_phase17() 6用例 + 148/148 + git commit `ae3876a` |

### Phase 17 新增 API

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| PUT | /internal/photos/:id/phash | X-Internal-Secret | Worker 写入 16字符 hex pHash（0行更新也返回 200）|
| GET | /api/photos/duplicates | JWT Bearer | 返回 {groups, total_groups}，每组含 ≥2 张 Hamming≤10 的相似照片 |

### Phase 18 方向（待规划）

| 优先级 | 方向 | 说明 |
|--------|------|------|
| 中 | 导出历史页 | 独立导出历史管理界面 + 状态跟踪 |
| 低 | AI 自动标签 | CLIP/BLIP 等模型批量添加语义标签 |
| 低 | 地图聚类优化 | MarkerCluster 替换当前单点渲染 |

**开始下一 Phase 步骤**：
1. 在 `outline/agent/` 创建新 Phase Roadmap 文档
2. 按规范实现 → build → 148/148 test → commit
3. 完成后更新第十节版本历史和本节

---

*文档维护规范：每次 commit 后同步更新第十节版本历史和第十五节当前状态。*
