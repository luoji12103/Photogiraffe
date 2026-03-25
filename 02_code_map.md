# 02 Code Map（逐代码粒度职责图谱）

## 1) Go Core 分层与职责

> 代码组织上以单文件路由为主（`go-core/main.go`），通过中间件与工具函数形成事实分层。

### 1.1 认证与鉴权

- JWT 验证与用户解析：`requireJWT()`
  - 证据：`go-core/main.go:100-122`
  - 职责：解析 `Authorization`，校验 JWT，`public_id -> users.id` 映射并注入 locals
- 角色控制：`requireRole()`
  - 证据：`go-core/main.go:126-138`
  - 职责：按 `userRole` 实施 RBAC
- Token 生成/校验：
  - 证据：`go-core/auth/jwt.go:34-67`, `71-86`
  - 职责：Access/Refresh token 生成与 Hash

### 1.2 核心业务路由（按链路）

- 上传与异步处理：
  - 上传入口：`go-core/main.go:1130-1190`
  - Worker 状态回写：`go-core/main.go:1193-1237`
  - 队列发布：`go-core/queue/redis.go:35-52`
- AI 分析与参数推断：
  - 分析触发：`go-core/main.go:1484-1537`
  - 分析回写：`go-core/main.go:1540-1563`
  - 推断触发与回写：`go-core/main.go:1570-1643`
- 导出：
  - 创建导出任务：`go-core/main.go:2016-2088`
  - 导出状态回写：`go-core/main.go:2236-2275`
- 备份：
  - 任务创建与查询：`go-core/main.go:2884-2963`
  - 回写：`go-core/main.go:2966-2994`

### 1.3 数据访问与模型

- DB 连接 + AutoMigrate：`go-core/database/db.go:16-56`
- 主要模型：`go-core/models/models.go:10-302`
  - 用户、照片、EXIF、导出任务、备份任务、通知、配额、AI 限流等

### 1.4 存储与队列客户端

- MinIO 初始化与 bucket 创建：`go-core/storage/minio.go:15-47`
- Redis 初始化与推送：`go-core/queue/redis.go:15-33`, `35-99`

---

## 2) Python Worker 职责映射

### 2.1 消费模型

- 启动与循环：`python-worker/main.py:1551-1652`
- 消费方式：`xreadgroup(..., count=1, block=5000)`
  - 证据：`python-worker/main.py:1564-1567`
- 四条流：
  - `image_processing_queue`, `ai_analysis_queue`, `export_queue`, `infer_params_queue`
  - 证据：`python-worker/main.py:194-199`

### 2.2 任务处理函数

- 图片处理：`process_image()`
  - 证据：`python-worker/main.py:240-419`
  - 行为：下载原图、RAW/非RAW解码、EXIF/XMP提取、生成 proxy/thumb、回写状态
- AI 分析：`process_ai_analysis()`
  - 证据：`python-worker/main.py:540-590`
- 导出：`process_export_task()`
  - 证据：`python-worker/main.py:1279+`
- 参数推断：`process_infer_params_task()`
  - 证据：`python-worker/main.py:1486+`

### 2.3 回写契约

- 照片状态：`PUT /internal/photos/:id/status`
  - 证据：`python-worker/main.py:389-394`, `415-417`
- AI 结果：`PUT /internal/photos/:id/analysis`
  - 证据：`python-worker/main.py:581-583`
- 导出状态：`PUT /internal/exports/:job_id/status`
  - 对应 API：`go-core/main.go:2236-2275`

---

## 3) 前端交互层（关键观察）

- API Proxy 模式：`frontend/src/app/api/**/route.ts`
  - 例：`frontend/src/app/api/photos/route.ts:3-29`
- SSE 代理：`frontend/src/app/api/events/stream/route.ts:16-53`
  - token 通过 query 透传上游

---

## 4) 配置与运行架构

- 容器拓扑与环境注入：`docker-compose.yml:3-112`
- Nginx 限流与转发：`nginx/nginx.conf:19-22`, `64-97`
- 安全环境变量检查：`go-core/main.go:320-330`

---

## 5) 关键链路当前契约（摘要）

1. Upload payload：multipart `image`
   - 证据：`go-core/main.go:1132`
2. Queue payload（图像处理）：`photo_id`, `minio_path`
   - 证据：`go-core/queue/redis.go:39-42`
3. Queue payload（AI）：含 `provider/base_url/api_key/model_name`
   - 证据：`go-core/main.go:1522-1530`
4. 对象命名：`raw/` -> `proxy/` + `thumb/`
   - 证据：`go-core/main.go:1145`, `python-worker/main.py:366-374`
5. 导出 URL TTL：15 分钟（作业下载）
   - 证据：`go-core/main.go:2221-2231`

---

## 6) 已识别的代码级关注点（详细风险见 `02_risk_register.md`）

- worker 对处理失败消息未统一 ACK，失败消息可能长期 pending（`python-worker/main.py:1581-1585`, `1601-1605`）
- AI 队列携带 `api_key` 明文（`go-core/main.go:1527`, `python-worker/main.py:1595`）
- 无 tenant/org 维度，隔离为用户级（`go-core/models/models.go` 全局检索无 tenant 字段）
