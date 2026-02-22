# v4.2 修图参数 AI 推断 — 实施计划

**日期**: 2026-02-22  
**基于**: 21_Phase4_Roadmap.md  
**选择方案**: **Option A — LLM prompt**（利用现有 AI 配置基础设施）

---

## 决策说明
跳过 CNN 回归模型（需成对训练数据集），直接使用多模态 LLM 估算调整参数。
现有 AI 配置（`ai_configs` 表、多 provider 支持）可完全复用。

---

## 改动范围

### 1. Go Core

**`go-core/models/models.go`**  
- `Photo` 结构体新增 `InferredParams *string` （jsonb，nullable）

**`go-core/queue/redis.go`**  
- 新增 `PublishInferParamsTask(photoID uint, minioPath string)` 推送到 `infer_params_queue`

**`go-core/main.go`**  
- `POST /api/photos/:id/infer-params` — 触发 AI 参数推断
- `PUT  /internal/photos/:id/inferred-params` — Worker 回调写入结果

### 2. Python Worker

**`python-worker/main.py`**  
- 新增 `INFER_STREAM_NAME = "infer_params_queue"`
- `init_redis()` 创建 `infer_params_queue` consumer group
- 新增 `process_infer_params_task(minio_client, photo_id, minio_path, ...)` 函数：
  1. 下载 proxy WebP 图片（MinIO, `proxy/*.webp`）
  2. Base64 编码 → 多模态 LLM（与现有 AI 分析共用 provider 逻辑）
  3. Prompt 要求返回 JSON: `{"exposure":x,"brightness":x,"contrast":x,"saturation":x,"tonemap":x}`
  4. 解析 JSON，写回 DB
- 主循环添加 `infer_params_queue` 消费

### 3. 前端

**`frontend/src/app/api/photos/[id]/infer-params/route.ts`**（新建）  
- POST: 代理到 go-core `/api/photos/:id/infer-params`

**`frontend/src/components/PhotoDetail.tsx`**  
- 在调色区顶部添加 "✨ AI Suggest" 按钮
- 点击 → POST → 轮询 photo 的 `InferredParams` 字段（3s，60s timeout）
- 推断完成 → 弹出预览弹窗 or 直接应用到 adjustParams

---

## LLM Prompt 设计
```
You are an expert photo retouching AI. Analyze this photograph and suggest 
optimal colour adjustment parameters to make it visually appealing.

Return ONLY a JSON object with these exact keys (no explanation, no markdown):
{
  "exposure":   <float, -3.0 to 3.0, typical range -1 to 1>,
  "brightness": <float, -1.0 to 1.0>,
  "contrast":   <float, -1.0 to 1.0>,
  "saturation": <float, 0.0 to 2.0, 1.0 = unchanged>,
  "tonemap":    <bool, true if the image looks overexposed or HDR>
}
```

---

## 风险控制
- LLM 返回非 JSON 时：用 regex 提取 JSON block，失败则标记为 failed
- 若 AI 配置不存在：返回 400 错误（与 /analyze 端点一致）
- 推断结果不自动覆盖现有 adjustParams，用户需主动点击 "Apply"
