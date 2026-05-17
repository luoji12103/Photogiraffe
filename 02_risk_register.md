# 02 Risk Register（代码风险登记）

> 分级：P0（高）/P1（中）/P2（低）

| ID | 风险 | 严重度 | 证据（文件+行） | 影响面 | 建议 |
|---|---|---|---|---|---|
| R-001 | JWT_SECRET 允许为空并使用默认值 | P0 | `go-core/main.go:320-321`, `go-core/auth/jwt.go:24-29`, `docker-compose.yml:57` | 安全 | 生产环境强制 JWT_SECRET 非空且长度合规；移除默认弱值 |
| R-002 | `.env` 包含真实样式密钥被纳入仓库 | P0 | `.env:7-9` | 安全/合规 | 从版本库移除敏感配置，改用 secret manager；轮换已泄露密钥 |
| R-003 | 内部接口仅依赖共享静态 secret，无签名/时效 | P1 | `go-core/main.go:268-275` | 安全 | 增加 mTLS 或短期签名令牌+重放保护 |
| R-004 | AI 任务消息包含明文 API key | P0 | `go-core/main.go:1527`, `go-core/queue/redis.go:90-98`, `python-worker/main.py:1595` | 安全/合规 | 队列只传 config_id，worker 侧拉取受控密文配置 |
| R-005 | Worker 消费失败时未统一 ACK/重试策略，可能永久 pending | P1 | `python-worker/main.py:1581-1585`, `1601-1605`, `1564-1567` | 可用性/可靠性 | 增加重试计数、失败回写、DLQ 与 pending reclaim（XAUTOCLAIM） |
| R-006 | 队列语义为至少一次，业务幂等不足 | P1 | `python-worker/main.py:1564-1645`, `go-core/main.go:1193-1237`, `2236-2275` | 数据一致性 | 为任务引入幂等键与状态机 CAS 更新 |
| R-007 | 多租户缺失（无 tenant/org 模型） | P0 | `go-core/models/models.go`（无 tenant_id/org_id 字段） | 商业化/隔离 | 建立 tenant/organization 模型，所有资源强制 tenant 过滤 |
| R-008 | MinIO 对象命名未 tenant-aware | P1 | `go-core/main.go:1145`, `python-worker/main.py:366-374` | 隔离/运维 | 路径前缀改为 `tenant/{tid}/user/{uid}/...` |
| R-009 | Redis key 设计缺少租户前缀与系统化 TTL 规范 | P1 | `go-core/main.go:210` | 隔离/可运维 | 统一 key 命名约定：`app:{tenant}:{domain}:{id}` + TTL policy |
| R-010 | Role 值存在不一致（`StandardUser` vs `User/admin`） | P1 | `go-core/models/models.go:16`, `go-core/main.go:4574` | 授权正确性 | 统一角色枚举并加约束校验 |
| R-011 | 观测能力不足：无 request-id / trace / metrics | P1 | `go-core/main.go:369`（仅 fiber.New） | 可观测性 | 加入 request-id、中间件日志、Prometheus 指标、告警基线 |
| R-012 | SSE token 通过 query 传递，存在日志泄漏风险 | P1 | `go-core/main.go:4434-4443`, `frontend/src/app/api/events/stream/route.ts:17-21` | 安全 | 改为短期一次性 SSE ticket 或 cookie/session |
| R-013 | compose 含默认弱口令回退值 | P0 | `docker-compose.yml:20`, `31-32`, `57` | 安全 | 启动前必填校验 + 强密码策略 |
| R-014 | 数据恢复治理不足（缺少明确 RPO/RTO 与演练） | P1 | 仅见备份作业接口：`go-core/main.go:2884-2994` | 韧性/合规 | 定义备份策略、校验恢复演练和审计留存 |
| R-015 | 计费计量能力缺失（仅有限流和配额片段） | P1 | `go-core/models/models.go:19-20`, `56-64`; `go-core/main.go:5084-5113` | 商业化 | 增加 metering 事件、账单汇总、套餐与超额策略 |

## 备注

- 以上结论均基于当前静态代码证据；动态行为（如 Redis retention 策略、DB 索引实际状态）需运行态进一步验证。
