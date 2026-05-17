# 安全加固方案 (v2.3)

## 问题清单

| # | 风险 | 严重程度 | 说明 |
|---|------|----------|------|
| S1 | **go-core 全部端点无认证** | 🔴 高危 | 8080 端口映射至宿主机，`/upload`、`/api/config/ai`、`/api/photos/:id/analyze` 完全公开，任意人可上传文件、读写 AI 密钥、消耗 AI 额度 |
| S2 | **`/internal/*` 路由对外暴露** | 🔴 高危 | Python Worker 专用的 `PUT /internal/photos/:id/status` 和 `/internal/photos/:id/analysis` 可被外部任意调用，篡改照片状态和 AI 结果 |
| S3 | **CORS 配置为 `AllowOrigins: "*"`** | 🟠 中危 | 任何网站可发起跨域请求，助推 CSRF 攻击 |
| S4 | **PostgreSQL 6432 / Redis 6379 绑定到 `0.0.0.0`** | 🟠 中危 | 仅靠弱默认密码（`postgres`/`redispass`）防护，宿主机网络可直接访问 |
| S5 | **API Key 明文写入 Redis Stream** | 🟡 低危 | 触发 AI 分析时 API Key 明文传入消息体，Redis 持久化后可被读取 |

## 修复方案

### S1 — go-core 端点认证

在 go-core 引入 `ADMIN_TOKEN` 环境变量，添加 `requireAuth` Fiber 中间件：
- 读取请求头 `Authorization: Bearer <token>` 并与 `ADMIN_TOKEN` 比对。
- 返回 `401` 时不泄露 Token 格式细节。
- **受保护路由**：`POST /upload`、`GET /api/config/ai`、`POST /api/config/ai`、`POST /api/photos/:id/analyze`。
- `/photos`（GET）和 `/photos/:id`（GET）暂时保持公开（仅读取元数据，无敏感操作）。

前端 Next.js API 路由（server-side）从 `process.env.ADMIN_TOKEN` 读取并在请求头中附加，浏览器永远不会接触到 Token。

### S2 — `/internal/*` 路由保护

引入 `INTERNAL_SECRET` 环境变量，添加 `requireInternalSecret` 中间件：
- 检查请求头 `X-Internal-Secret: <secret>`。
- Python Worker 在所有 `/internal/` 调用中附加此头。
- **受保护路由**：`PUT /internal/photos/:id/status`、`PUT /internal/photos/:id/analysis`。

### S3 — CORS 收紧

用 `CORS_ALLOW_ORIGIN` 环境变量替换硬编码的 `*`，默认值 `http://localhost:3000`。

### S4 — 数据库端口绑定本地

docker-compose 中将 PostgreSQL 和 Redis 端口绑定改为 `127.0.0.1`：
- `"127.0.0.1:5432:5432"`
- `"127.0.0.1:6379:6379"`

go-core 的 8080 端口同样绑定到 `127.0.0.1`，避免从其他网卡访问。

### S5 — Redis Stream 中的 API Key（后续）
当前阶段 API Key 仍明文传入 Redis（低优先级）。后续版本可考虑引入数据库加密（AES-GCM）或使用 go-core 从 DB 直接查询 Key 而非通过 Redis 传递，从而彻底消除 Key 在 Stream 中的暴露。

## 实施步骤

1. **`go-core/main.go`**：新增 `os` import，添加 `requireAuth` 和 `requireInternalSecret` 两个中间件函数，将其注册到对应路由，更新 CORS 配置为从环境变量读取。
2. **`docker-compose.yml`**：添加 `ADMIN_TOKEN`、`INTERNAL_SECRET`、`CORS_ALLOW_ORIGIN` 环境变量；修改端口绑定。
3. **`python-worker/main.py`**：读取 `INTERNAL_SECRET` 环境变量，所有 `requests.put(..., /internal/...)` 调用中添加 `X-Internal-Secret` 请求头。
4. **前端 Next.js API 路由**：在 `api/config/ai/route.ts` 和 `api/photos/[id]/analyze/route.ts` 的服务端 fetch 中添加 `Authorization: Bearer ${process.env.ADMIN_TOKEN}` 头。
5. **重建所有修改过的容器并验证**。

## 预期结果

- 浏览器无法直接调用 go-core 任何敏感端点（CORS + 无 Token）。
- `/internal/*` 路由只接受持有正确 `X-Internal-Secret` 的 Python Worker 调用。
- 数据库和 Redis 端口仅宿主机 127.0.0.1 可访问，外部网络无法穿透。
