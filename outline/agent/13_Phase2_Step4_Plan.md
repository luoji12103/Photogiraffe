# Phase 2 Step 4: AI 艺术解构与摄影分析 (Python + 多模态大模型)

## 目标
实现 AI 对照片的深度分析。Go Core 提供触发分析的接口并将任务推入 Redis 队列。Python Worker 消费任务，读取数据库中的 AI 配置，调用多模态大模型（如 GPT-4o / Gemini 1.5 Pro）对照片进行分析，并将结构化的分析结果（画面描述、构图分析、色彩情绪、艺术建议）保存回数据库。

## 预计修改方向
1. **Go Core 模型与数据库**:
   - 在 `go-core/models/models.go` 中扩展 `Photo` 模型，增加 `AIAnalysis` 字段（JSONB 类型）用于存储分析结果。
   - 更新 `go-core/database/db.go` 进行自动迁移。
2. **Go Core API**:
   - 在 `go-core/main.go` 中添加 `POST /api/photos/:id/analyze` 接口，用于触发 AI 分析任务。
   - 该接口需要读取最新的 `AIConfig`，并将配置信息和照片信息一起推入 Redis 队列（例如 `ai_analysis_queue`）。
   - 添加 `PUT /internal/photos/:id/analysis` 内部接口，供 Python Worker 回传分析结果。
3. **Python Worker 依赖**:
   - 更新 `python-worker/requirements.txt`，添加 `openai` 库（用于兼容 OpenAI API 格式的模型调用）。
4. **Python Worker 核心逻辑**:
   - 修改 `python-worker/main.py`，增加对 `ai_analysis_queue` 的监听。
   - 接收到任务后，从 MinIO 获取照片的代理图（Proxy）的临时访问链接或直接下载。
   - 使用任务中提供的 `AIConfig`（BaseURL, APIKey, ModelName）初始化 OpenAI 客户端。
   - 构造 Prompt，要求 AI 以 JSON 格式返回结构化的摄影分析数据（画面描述、构图分析、色彩情绪、艺术建议）。
   - 调用多模态大模型 API，解析返回的 JSON 结果。
   - 调用 Go Core 的内部接口，将分析结果保存到数据库。
5. **前端展示 (可选，视时间而定)**:
   - 在 `frontend/src/components/PhotoDetail.tsx` 中增加 AI 分析结果的展示区域。

## 预期结果
用户在前端点击“AI 分析”按钮后，后端触发异步任务。Python Worker 成功调用配置的 AI 模型对照片进行分析，并将结构化的结果保存到数据库。前端能够获取并展示这些分析数据。
