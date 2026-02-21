# Phase 2 Step 3: 动态 AI 配置与底层接入 (Go + 数据库)

## 目标
在数据库中设计表结构，允许存储加密的 AI Base URL、API Key 和模型名称。Go Core 提供相关的 CRUD API 供前端配置。

## 预计修改方向
1. **数据库模型更新 (`go-core/models/models.go`)**:
   - 新增 `AIConfig` 模型，包含 `BaseURL`, `APIKey`, `ModelName` 等字段。
   - 考虑对 `APIKey` 进行简单的加密存储（可选，但推荐）。
2. **数据库迁移 (`go-core/database/db.go`)**:
   - 在 `AutoMigrate` 中添加 `AIConfig` 模型。
3. **Go Core API 开发 (`go-core/main.go`)**:
   - 新增 `GET /api/config/ai` 接口，获取当前的 AI 配置（隐藏 API Key）。
   - 新增 `POST /api/config/ai` 接口，更新 AI 配置。
4. **前端配置页面 (`frontend/src/app/settings/page.tsx`)**:
   - 创建一个设置页面，允许用户输入和保存 AI 配置。
   - 使用表单提交数据到 Go Core API。

## 预期结果
用户可以在前端设置页面配置他们自己的 AI 服务（如 OpenAI, Anthropic, 或本地模型），这些配置将被安全地存储在数据库中，供后续的 AI 艺术解构功能使用。
