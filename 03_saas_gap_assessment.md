# 03 SaaS Gap Assessment（SaaS 能力差距评估）

评分标准：0（缺失）~5（完善）

## 总览评分

| 控制域 | 分数 | 结论 |
|---|---:|---|
| Tenant Isolation | 1/5 | 仅用户级隔离，无租户边界模型 |
| AuthN/AuthZ | 3/5 | JWT+RBAC 基础具备，但角色枚举不一致、密钥策略待强化 |
| Billing/Metering | 1/5 | 有配额与限流片段，缺少计量账单主链路 |
| Reliability | 2/5 | Redis Streams + ACK 存在，但重试/DLQ/补偿不完整 |
| Observability | 1/5 | 基础日志存在，无 trace/metrics/告警体系 |
| Security | 2/5 | 有内部 secret 与鉴权，但存在默认弱值与密钥暴露面 |
| Delivery | 2/5 | 有容器编排，无 CI/CD 分层发布证据 |
| Data Governance | 2/5 | 有备份作业接口，但合规删除/恢复演练证据不足 |

---

## 1) Tenant Isolation（1/5）

- 证据
  - 数据模型仅 `user_id` 粒度，无 `tenant_id` / `org_id`：`go-core/models/models.go:31-302`
  - 对象路径无租户前缀：`go-core/main.go:1145`; `python-worker/main.py:366-374`
- 风险
  - 难以实现组织级隔离、配额和计费；企业 SaaS 扩展受限
- 建议
  - 建立 Tenant/Organization/Member 模型；DB 与对象存储统一 tenant namespace

## 2) AuthN/AuthZ（3/5）

- 证据
  - JWT + role middleware：`go-core/main.go:100-138`
  - 首用户超级管理员：`go-core/main.go:417-423`
  - 角色值不一致：`go-core/models/models.go:16` vs `go-core/main.go:4574`
- 风险
  - 角色漂移可能导致权限错配
- 建议
  - 统一角色枚举；引入资源级策略（RBAC->ABAC）

## 3) Billing/Metering（1/5）

- 证据
  - 存储配额字段：`go-core/models/models.go:19-20`
  - AI 频率限制：`go-core/main.go:201-225`
- 缺口
  - 无 usage ledger、无账单周期、无套餐/超额规则

## 4) Reliability（2/5）

- 证据
  - Stream + consumer group：`python-worker/main.py:1564-1567`
  - 失败处理不一致：仅成功时 ACK（图像/AI），导出总是 ACK
    - `python-worker/main.py:1581-1585`, `1601-1605`, `1625`, `1644`
- 风险
  - 消息 pending 堆积、重复处理、人工干预成本高
- 建议
  - 标准化重试+DLQ+死信回放；新增任务状态机与幂等键

## 5) Observability（1/5）

- 证据
  - Go 仅基础日志与 Fiber 默认初始化：`go-core/main.go:369`
  - 无 traceID 贯穿上传->队列->worker->回写路径
- 建议
  - 引入 OpenTelemetry、Prometheus、结构化日志字段（request_id/job_id/photo_id）

## 6) Security（2/5）

- 证据
  - internal secret 检查：`go-core/main.go:323-326`, `268-275`
  - JWT 默认回退：`go-core/main.go:320-321`
  - 明文 API key 入队：`go-core/main.go:1527`
  - `.env` 含敏感信息：`.env:7-9`
- 建议
  - 强制密钥策略、移除仓库敏感配置、KMS/Secrets Manager、最小暴露

## 7) Delivery（2/5）

- 证据
  - docker-compose 与 nginx 部署配置齐全：`docker-compose.yml`, `nginx/nginx.conf`
  - 未见 CI/CD 工作流与回滚策略证据（仓库当前内容）

## 8) Data Governance（2/5）

- 证据
  - 备份任务接口：`go-core/main.go:2884-2994`
  - 但未见数据生命周期策略、恢复演练、审计固化机制

---

## 关键未知项 / 待验证项

1. PostgreSQL 索引与 VACUUM 策略在生产环境是否已配置（静态代码不可见）
2. Redis Stream retention / maxlen 策略是否在运行态控制（代码未见）
3. MinIO 服务端加密/版本控制策略是否开启（代码未见）
4. CI/CD 与发布策略是否存在于外部流水线系统（仓库未见）
