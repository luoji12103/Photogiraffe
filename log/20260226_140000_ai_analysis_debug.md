# Debug Log — AI 分析结果相同 + Kimi 静默失败 + 中英文提示词

**时间**：2026-02-26  
**状态**：✅ 已修复并部署  
**测试**：142/142 PASS  

---

## 一、问题描述

用户反馈：**对不同照片执行 AI 分析，所有照片返回的分析结果完全相同**。

---

## 二、根因分析

### Bug #1（主因）— AI_ANALYSIS_PROMPT 内嵌 JSON 占位字符串

**文件**：`python-worker/main.py`

旧版 `AI_ANALYSIS_PROMPT` 的结构：

```python
AI_ANALYSIS_PROMPT = """
You are an expert photography critic and art analyst. Analyze the provided image and return a JSON object with the following structure:
{
    "description": "A detailed description of the scene, subjects, and lighting.",
    "composition": "Analysis of the composition techniques used (e.g., rule of thirds, leading lines, framing).",
    "color_emotion": "Analysis of the color palette and the emotional impact or mood it conveys.",
    "artistic_advice": "Constructive feedback or suggestions for improvement from an artistic perspective."
}
Ensure the response is valid JSON only, no markdown fences.
"""
```

**问题机制**：

当 `response_format={"type": "json_object"}` 与该 prompt 共同发送时，模型进入「格式合规模式」——它识别到 prompt 已经提供了一个完整的 JSON 结构和填充好的字符串值，因此将这些占位文本（`"A detailed description of the scene..."` 等）原样复制到响应中，而不是真正分析图片内容。

这导致：
- 所有照片的分析结果字段值完全相同（均为 prompt 中的模板文字）
- 模型不读取/不分析图片内容
- 问题在各主流 provider（OpenAI、Kimi、智谱等）上均可复现

**复现路径**：
1. 用户在 Settings → AI API 配置任意 OpenAI-compatible provider
2. 对多张不同照片触发 AI Analysis
3. 每张照片的 description/composition/color_emotion/artistic_advice 字段值完全相同

同样的问题存在于 `INFER_PARAMS_PROMPT`：
```python
# 旧版 (有问题)
{
  "exposure":   <float -3.0 to 3.0, typical -1 to 1>,
  ...
}
```
`<float ...>` 占位符格式较好，但仍有部分模型返回字面占位值。

---

### Bug #2（次因）— `kimi` 未加入 `PROVIDER_BASE_URLS`

**文件**：`python-worker/main.py`

```python
# 旧版 PROVIDER_BASE_URLS（缺少 kimi）
PROVIDER_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "minimax": "https://api.minimax.chat/v1",
    # ← kimi 缺失
}
```

当用户选择 Kimi provider 时：
- 前端 `kimi` entry 没有 `needsBaseUrl: true`，所以 `config.BaseURL = ""`
- 后端保存 `AIConfig.BaseURL = ""`
- Worker 执行 `PROVIDER_BASE_URLS.get("kimi", "")` → 返回 `""` (空)
- `if not effective_base_url: raise ValueError(...)` → 静默失败
- 照片分析一直处于 pending 状态，前端 spinner 永远不停

---

## 三、修复方案

### Fix #1 — 重写提示词（消除占位 JSON 结构）

新版使用**项目符号描述字段期望**的格式，不嵌入任何可能被模型当作「正确答案」的 JSON 值：

```python
# EN 版本
AI_ANALYSIS_PROMPT_EN = """You are an expert photography critic and art analyst. Carefully examine the photograph provided and return a JSON object with EXACTLY these four keys. Base your answer entirely on what you actually observe in THIS specific image.

Required keys:
  description     – 2-3 sentences describing the main subject, scene, and lighting conditions you observe.
  composition     – Which specific composition technique(s) are visible (rule of thirds, leading lines, symmetry, framing, negative space, etc.).
  color_emotion   – The dominant colours present and the mood or emotional atmosphere they create.
  artistic_advice – One concrete, actionable improvement suggestion tailored to this particular photograph.

Return ONLY the JSON object, no markdown fences, no extra text."""

# ZH 版本（中文提示词）
AI_ANALYSIS_PROMPT_ZH = """你是一位专业的摄影评论家和艺术分析师。请仔细观察所提供的照片，根据你对本张图片的实际感知，返回一个包含以下四个字段的 JSON 对象。
[...]"""
```

关键改动：
1. 去掉了内嵌 JSON 结构（不再有 `{...}` 示例）
2. 用破折号列表描述字段期望
3. 强调「THIS specific image」和「you actually observe」，防止模型忽略图片
4. 同步重写 `INFER_PARAMS_PROMPT_EN/ZH`

### Fix #2 — 加入 kimi 到 PROVIDER_BASE_URLS

```python
PROVIDER_BASE_URLS = {
    "openai":   "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "minimax":  "https://api.minimax.chat/v1",
    "kimi":     "https://api.moonshot.cn/v1",  # 新增
}
```

---

## 四、功能顺带实现：中英文 AI 提示词语言选择

在修复过程中同步实现用户需求：在 AI settings 页面可选择提示词语言（中文/英文），让模型以对应语言回复。

### 数据模型

**`go-core/models/models.go`** — `AIConfig` 新增字段：
```go
PromptLanguage string `gorm:"default:'en'"` // "en" | "zh"
```

### Go Core API

**`go-core/main.go`**：
- `POST /api/config/ai`：保存 `PromptLanguage`
- `POST /api/photos/:id/analyze`：将 `prompt_language` 写入 Redis task
- `POST /api/photos/:id/infer-params` → `queue.PublishInferParamsTask`：新增 `promptLanguage` 参数

**`go-core/queue/redis.go`**：
- `PublishInferParamsTask` 新增 `promptLanguage string` 参数，写入 Redis 消息体

### Python Worker

所有 `_call_*` 函数签名新增 `prompt: str` 参数（替代之前的硬编码全局常量）：
- `_call_openai_compatible(..., prompt)`
- `_call_google(..., prompt)`
- `_call_anthropic(..., prompt)`
- `_call_zhipu(..., prompt)`
- `_call_openai_infer(..., prompt)`
- `_call_google_infer(..., prompt)`
- `_call_anthropic_infer(..., prompt)`

`process_ai_analysis` 和 `process_infer_params_task` 新增 `prompt_lang="en"` 参数，在函数入口处选择：
```python
prompt = AI_ANALYSIS_PROMPT_ZH if prompt_lang == "zh" else AI_ANALYSIS_PROMPT_EN
```

Worker 主循环：从 Redis 消息体中读取 `prompt_language` 字段传递给上述函数。

### 前端

**`frontend/src/app/settings/page.tsx`**：
- `AIConfig` interface 新增 `PromptLanguage: string`
- 初始值 `PromptLanguage: "en"`
- `fetchConfig` 读取并设置 `PromptLanguage`
- AI 设置页 API Key 字段下方新增「AI 回复语言」双按钮切换器（🌐 English / 🇨🇳 中文）
- 切换后保存配置时自动写入后端

---

## 五、修改文件汇总

| 文件 | 变更 |
|------|------|
| `python-worker/main.py` | 重写 `AI_ANALYSIS_PROMPT` → `EN/ZH` 两版；重写 `INFER_PARAMS_PROMPT` → `EN/ZH` 两版；加 `kimi` 到 `PROVIDER_BASE_URLS`；所有 `_call_*` 函数加 `prompt` 参数；`process_*` 加 `prompt_lang`；worker 循环读 `prompt_language` |
| `go-core/models/models.go` | `AIConfig.PromptLanguage string` (gorm default 'en') |
| `go-core/queue/redis.go` | `PublishInferParamsTask` 增加 `promptLanguage` 参数 |
| `go-core/main.go` | analyze 和 infer-params 路由传 `prompt_language`；config 保存 `PromptLanguage` |
| `frontend/src/app/settings/page.tsx` | `AIConfig` 接口加 `PromptLanguage`；语言切换 UI |

---

## 六、验证

```
go vet ./...  → VET_OK
docker compose up -d --build go-core python-worker → 成功
python3 tests/integration_test.py → 142/142 PASS
```
