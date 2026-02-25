# Phase 15 Roadmap — 简约边框渲染引擎

## 目标

在单张照片导出流程中，可选地为照片生成简约边框效果，并在边框区域动态排版展示：
- 拍摄参数（相机机身 · 镜头 · 光圈 · 快门 · ISO · 焦距）
- 拍摄日期
- 摄影师描述文字（Photo.Description）
- AI 分析摘要（Photo.AIAnalysis 首句，可选）
- 版权/创作者信息（Copyright / Creator）

边框适配多种目标画布比例（16:9 / 4:3 / 3:2 / 1:1 / 16:10 / 4:5 / 3:4 / 21:9 / 原始），
并根据照片自身比例与文字内容量动态规划照片位置、文字尺寸、区域高度。

---

## 技术路径

### v15.1 — Go Core 内部元数据接口
新增 `GET /internal/photos/:id/meta`（X-Internal-Secret），返回完整照片元信息：
- 基础：description, ai_analysis, copyright, creator
- EXIF：camera_model, lens_model, focal_length, aperture, shutter_speed, iso, date_time_original

### v15.2 — Python Worker 边框渲染引擎

新增全局常量与工具函数：
- `_CANVAS_RATIOS`: 目标画布比例映射表
- `_FRAME_THEMES["white"|"dark"|"film"]`: 背景/文字/分割线颜色方案
- `_try_font(size)`: 从系统路径查找 TrueType 字体，降级到 PIL 内置
- `_measure_text(text, font, draw)`: 测量文字宽高
- `_fit_text(text, font, max_width, draw)`: 截断加省略号
- `_wrap_text(text, font, max_width, draw, max_lines)`: 自动换行

新增主函数 `_render_frame(img, meta, frame_opts)`:
1. 解析 frame_opts（frame_style, frame_ratio, frame_show_exif, frame_show_desc, frame_show_ai）
2. 组装文字内容行（primary_lines: 相机+镜头；secondary_lines: 参数/日期/描述/AI）
3. 计算字号（参考边长的 2.2% / 1.8% / 1.5%）
4. 计算信息区高度 = 内边距 + 行高累加 + 版权行
5. 自然画布 = 照片 + 4.5% 外边距 + 信息区
6. 按目标比例扩展画布（更宽 → 扩宽居中；更高 → 扩增信息区）
7. 贴照片、绘分割线、逐行绘文字、右对齐版权信息

在 `process_export_task` 步骤 5（水印）之后 / 步骤 6（保存）之前插入：
```python
frame_style = opts.get("frame_style", "")
if frame_style and frame_style not in ("none", "off"):
    frame_meta = fetch /internal/photos/{id}/meta
    img = _render_frame(img, frame_meta, opts)
```

### v15.3 — 前端 ExportPanel 边框选项

新增状态：frameEnabled, frameStyle, frameRatio, frameShowExif, frameShowDesc, frameShowAi

新增 UI 可折叠区块「简约边框」：
- 开启/关闭 toggle
- 风格：简约白 / 简约黑 / 胶片
- 画布比例：原始 / 16:9 / 4:3 / 3:2 / 1:1 / 16:10 / 4:5 / 3:4 / 21:9
- 内容显示：EXIF 参数（默认开）/ 描述（默认开）/ AI 分析（默认关）

向 POST /api/photos/:id/export 请求体新增字段：
frame_style, frame_ratio, frame_show_exif, frame_show_desc, frame_show_ai

### v15.4 — 构建/测试/提交
- go build ./... → 通过
- python3 tests/integration_test.py → 129/129
- git commit

---

## 布局示意

**底部信息栏（横向照片 + 宽画布）：**
```
┌─────────────────────────────────────────────┐
│ M                                       M   │
│  ┌───────────────────────────────────┐    │
│  │              PHOTO                │    │
│  └───────────────────────────────────┘    │
│  ─────────────── divider ─────────────     │
│  Canon EOS R5 · RF 85mm f/1.2  (large)    │
│  f/1.2 · 1/500s · ISO 800 · 85mm          │
│  2024/03/15                               │
│  "摄影师描述文字..."                        │
│  AI  "AI 分析首句摘要..."                   │
│                           © John Doe  M   │
└─────────────────────────────────────────────┘
```

**竖向照片 + 16:9 画布：**
```
┌───────────────────────────────────────────────────┐
│ M  ┌──────────┐  Canon EOS R5                M    │
│    │          │  RF 85mm f/1.2                    │
│    │  PHOTO   │  ────────────────────────         │
│    │          │  f/1.2 · 1/500s · ISO 800         │
│    │          │  "描述..."                         │
│    └──────────┘           © John Doe              │
│ M                                            M    │
└───────────────────────────────────────────────────┘
```

---

## 依赖

- Pillow：ImageDraw, ImageFont（已有）
- 系统字体（DejaVu / Liberation / FreeSans 等 TrueType，降级到 PIL 内置）
- 无新 Python 包依赖

---

## 文件变更

| 文件 | 类型 |
|------|------|
| go-core/main.go | 新增内部元数据端点 |
| python-worker/main.py | PIL import 补充 + 6 个辅助函数 + _render_frame + process_export_task 插入 |
| frontend/src/components/ExportPanel.tsx | 边框选项 UI + 请求体字段 |
