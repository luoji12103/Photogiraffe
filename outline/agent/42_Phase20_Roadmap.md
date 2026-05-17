# Phase 20 Roadmap — CLIP 本地自动标签 (v0.20)

**Date:** 2026-02-26  
**Status:** Planned  
**Priority:** Medium（用户选择：本地轻量模型）

---

## 目标

在照片上传处理完成后，利用 Python Worker 内置的 CLIP 模型（无需调用外部 API）自动为照片生成语义标签，并支持批量补标和手动触发。

- **自动触发**：照片处理完成（`completed`）后排入自动标签队列
- **本地 CLIP**：使用 `open-clip-torch` + CPU 推理，无需 GPU，镜像体积增加约 ~400MB
- **标签词汇表**：150 个精选摄影相关标签（题材、风格、时段、地点类型等），零样本分类 top-5
- **不覆盖手动标签**：自动标签写入 `auto_tags` 字段（独立于用户手动 `tags`）
- **批量补标**：管理员或用户可对已有照片触发批量重新标签
- **前端展示**：PhotoDetail 展示自动标签徽章（灰色/蓝色区分手动与自动）

---

## 版本规划

| 子版本 | 内容 | 涉及文件 |
|--------|------|----------|
| v0.20.1 | 模型：Go Core models.go 添加 AutoTags 字段；DB AutoMigrate | `go-core/models/models.go`, `go-core/database/db.go` |
| v0.20.2 | Go Core: `POST /api/photos/:id/auto-tag` 触发任务 + `PUT /internal/photos/:id/auto-tags` 回调 | `go-core/main.go` |
| v0.20.3 | Python Worker: `open-clip-torch` 依赖 + 标签词汇表 + `process_auto_tag_task()` | `python-worker/requirements.txt`, `python-worker/main.py` |
| v0.20.4 | Frontend: PhotoDetail 自动标签徽章 + 触发按钮 + 代理路由 | `frontend/src/components/PhotoDetail.tsx`, `frontend/src/app/api/photos/[id]/auto-tag/route.ts` |
| v0.20.5 | 测试 + build + commit | `tests/integration_test.py` |

---

## 标签词汇表（摄影专用，150 个）

**题材（30）**：landscape, portrait, street photography, architecture, wildlife, macro, astrophotography, underwater, sports, documentary, fashion, food, travel, aerial, abstract, still life, wedding, event, urban, rural, night photography, long exposure, environmental portrait, candid, photojournalism, nature, cityscape, seascape, pattern, silhouette

**光线/时段（20）**：golden hour, blue hour, sunset, sunrise, midday light, overcast, harsh light, soft light, backlight, side light, rim light, studio light, natural light, artificial light, neon light, fog, misty, rainy, snow, dramatic sky

**风格（20）**：black and white, high contrast, low key, high key, minimalist, vibrant colors, desaturated, film grain, vintage, cinematic, fine art, editorial, documentary style, ethereal, moody, dreamy, surreal, raw, clean, bold

**技术（20）**：bokeh, shallow depth of field, deep focus, motion blur, freeze motion, tilt-shift, panoramic, HDR, infrared, double exposure, reflection, symmetry, leading lines, rule of thirds, negative space, framing, texture detail, wide angle, telephoto, fisheye

**环境（20）**：forest, mountain, desert, beach, ocean, lake, river, city, suburb, countryside, indoors, studio, cafe, market, park, rooftop, alley, industrial, abandoned, snowy

**情绪（20）**：calm, dramatic, joyful, melancholy, mysterious, romantic, intense, peaceful, nostalgic, awe-inspiring, intimate, solitary, playful, tense, serene, energetic, ethereal, dark, bright, hopeful

**主体（20）**：person, people, animal, cat, dog, bird, flower, tree, building, vehicle, water, sky, crowd, couple, child, elderly, athlete, artist, musician, performer

---

## 技术实现

### Python Worker
```python
import open_clip
import torch
from PIL import Image
import io

# 模块级单例（懒加载）
_CLIP_MODEL = None
_CLIP_PREPROCESS = None
_CLIP_TOKENIZER = None
_TAG_EMBEDDINGS = None  # 预计算的 text embeddings，shape (150, 512)

PHOTO_TAGS = [...]  # 150 个标签列表

def _get_clip():
    global _CLIP_MODEL, _CLIP_PREPROCESS, _CLIP_TOKENIZER, _TAG_EMBEDDINGS
    if _CLIP_MODEL is None:
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        model.eval()
        tokenizer = open_clip.get_tokenizer("ViT-B-32")
        
        # 预计算所有标签的文本嵌入
        with torch.no_grad():
            text_tokens = tokenizer([f"a photo of {t}" for t in PHOTO_TAGS])
            text_features = model.encode_text(text_tokens)
            text_features /= text_features.norm(dim=-1, keepdim=True)
        
        _CLIP_MODEL = model
        _CLIP_PREPROCESS = preprocess
        _CLIP_TOKENIZER = tokenizer
        _TAG_EMBEDDINGS = text_features
    return _CLIP_MODEL, _CLIP_PREPROCESS, _TAG_EMBEDDINGS

def process_auto_tag_task(task_data):
    photo_id = task_data["photo_id"]
    minio_path = task_data["minio_path"]  # proxy WebP 路径
    
    # 获取缩略图
    thumb_path = minio_path.replace("raw/", "thumb/").rsplit(".", 1)[0] + ".webp"
    # 尝试 proxy 再 thumb
    image_data = None
    for p in [minio_path.replace("raw/", "proxy/").rsplit(".", 1)[0] + ".webp", thumb_path]:
        try:
            resp = minio_client.get_object(bucket_name, p)
            image_data = resp.read(); resp.close(); resp.release_conn(); break
        except: pass
    if image_data is None:
        raise RuntimeError("No image available for CLIP tagging")
    
    model, preprocess, tag_embeddings = _get_clip()
    img = preprocess(Image.open(io.BytesIO(image_data))).unsqueeze(0)
    
    with torch.no_grad():
        img_features = model.encode_image(img)
        img_features /= img_features.norm(dim=-1, keepdim=True)
        similarity = (100.0 * img_features @ tag_embeddings.T).softmax(dim=-1)
    
    top5_indices = similarity[0].topk(5).indices.tolist()
    top5_tags = [PHOTO_TAGS[i] for i in top5_indices]
    
    # 回调保存
    auto_tags_json = json.dumps(top5_tags)
    requests.put(f"{INTERNAL_API_URL}/internal/photos/{photo_id}/auto-tags",
                 json={"auto_tags": auto_tags_json},
                 headers={"X-Internal-Secret": INTERNAL_SECRET})
```

### Go Core
```go
// models.go
AutoTags *string `gorm:"type:jsonb"` // JSON 字符串数组，nullable

// 端点
POST /api/photos/:id/auto-tag     → 推入 photogiraffe_auto_tag_tasks Redis Stream
PUT /internal/photos/:id/auto-tags → 写入 AutoTags 字段（Worker 回调）
```

### Redis Stream
```
Stream: photogiraffe_auto_tag_tasks
Fields: photo_id, minio_path, user_id
```

---

## 前端展示

PhotoDetail 的标签区域分为两块：
1. **手动标签**（蓝灰色）：用户手动编辑的 `tags`
2. **AI 自动标签**（绿色/半透明）：`auto_tags`，标注 `✨AI` 前缀

---

## 镜像体积评估

| 包 | 大小 |
|----|------|
| torch (CPU only) | ~200MB |
| open_clip_torch | ~30MB |
| ViT-B-32 模型（首次下载，缓存在容器 volume）| ~340MB |
| torchvision | ~30MB |
| 合计（镜像层，不含模型缓存）| ~260MB |

> 模型文件在 Worker 首次调用时下载到 `~/.cache/`，建议挂载 Docker volume 持久化：`python-worker-cache:/root/.cache`

---

## 依赖

```
open-clip-torch>=2.24.0
torch>=2.2.0     # CPU only 版本通过 --extra-index-url
torchvision>=0.17.0
```

Docker build arg：`pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`
