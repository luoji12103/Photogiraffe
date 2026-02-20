# Phase 1 Step 1: 基础设施编排与初始化

## 目标
搭建 Photogiraffe 项目的基础设施，包括数据库、缓存/消息队列、对象存储，以及 Go 核心 API 和 Python Worker 的基础容器。

## 预计修改方向
1. 创建项目根目录下的 `docker-compose.yml`，编排以下服务：
   - `postgres`: 关系型数据库，存储用户、照片元数据等。
   - `redis`: 缓存与消息队列（Redis Streams），用于 Go 和 Python 之间的异步通信。
   - `minio`: 兼容 S3 的对象存储，用于存储原图、代理图和缩略图。
   - `go-core`: Go 核心业务 API 容器。
   - `python-worker`: Python 图像与 AI 处理微服务容器。
2. 创建 `.env` 文件，集中管理环境变量（数据库密码、MinIO 密钥等）。
3. 初始化 `go-core` 目录，包含基础的 `main.go` (提供健康检查接口)、`go.mod` 和 `Dockerfile`。
4. 初始化 `python-worker` 目录，包含基础的 `main.py` (模拟监听循环)、`requirements.txt` 和 `Dockerfile`。

## 预期结果
执行 `docker-compose up -d` 后，所有 5 个容器能够成功启动并保持运行，Go API 能够响应 `/health` 请求。