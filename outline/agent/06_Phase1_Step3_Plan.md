# Phase 1 Step 3: Go Core API 的 MinIO 直传接口与 Redis 消息发布

## 目标
在 Go Core API 中实现图片上传接口。该接口需要接收前端上传的图片，将其保存到 MinIO 对象存储中，在 PostgreSQL 中创建一条状态为 `processing` 的记录，并通过 Redis Streams 发布一条异步处理任务消息给 Python Worker。

## 预计修改方向
1. **依赖引入**: 在 `go-core/go.mod` 中引入 `github.com/minio/minio-go/v7` 和 `github.com/redis/go-redis/v9`。
2. **MinIO 客户端初始化**: 创建 `go-core/storage/minio.go`，读取环境变量初始化 MinIO 客户端，并确保 `photos` bucket 存在。
3. **Redis 客户端初始化**: 创建 `go-core/queue/redis.go`，读取环境变量初始化 Redis 客户端。
4. **上传接口实现**: 
   - 在 `go-core/main.go` 中添加 `/upload` 路由。
   - 解析 `multipart/form-data` 获取上传的文件。
   - 生成唯一的文件名（如 UUID），将文件流式上传至 MinIO 的 `photos` bucket。
   - 在 PostgreSQL 的 `photos` 表中插入一条新记录，记录 `OriginalFilename` 和 `MinioPath`，状态默认为 `processing`。
   - 向 Redis Stream `image_processing_queue` 发布一条消息，包含 `PhotoID` 和 `MinioPath`。
5. **路由与中间件**: 引入 `github.com/gofiber/fiber/v2` 替换原生的 `net/http`，以获得更好的性能和更简洁的路由 API（符合架构蓝图中的选型）。

## 预期结果
重启 `go-core` 容器后，可以通过 POST 请求向 `/upload` 接口上传图片。上传成功后，MinIO 中会出现该文件，PostgreSQL 中会新增一条记录，Redis Stream 中会新增一条消息。