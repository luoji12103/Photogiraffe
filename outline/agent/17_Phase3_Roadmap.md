# Photogiraffe - Phase 3 详细 Roadmap：极致视觉与色彩管理

> 本文档是对 `09_Phase2_to_5_Roadmap.md` 中 Phase 3 章节的展开与细化。
> 在 Phase 2 / v2.4 全部完成的基础上编写，紧接 v3.0 (Phase 3 Step 1) 已交付。

---

## Phase 3 总体目标

让 Photogiraffe 成为**色彩正确的专业级影像平台**：

1. 服务端：精确处理 ICC Profile，生成色彩保真的 WebP 代理图
2. 客户端：借助 WebAssembly + WebGL 在浏览器内实现接近 Camera Raw 的渲染质量
3. 显示端：检测屏幕色域，动态选择输出色彩空间（sRGB / Display P3 / HDR）

---

## Step 1 ✅ ICC Profile 感知代理生成（v3.0，已交付）

**核心问题**：原有 `Pillow.convert("RGB")` 静默丢弃广色域信息，导致 Adobe RGB / Display P3 照片在浏览器显示偏色。

**已交付内容**：
- `python-worker/main.py`：新增 `get_icc_profile_name()` + `convert_to_srgb()`，基于 ICC Profile / NCLX 执行精确 sRGB 转换
- `go-core/models/models.go`：`ExifData` 新增 `ICCProfileName string` 列（GORM 自动迁移）
- `frontend/src/components/PhotoDetail.tsx`：色彩空间徽章（sRGB=蓝、Adobe RGB=橙、P3=紫、Rec.2020=靛）

**验证**：Sony A6704325.HIF 上传后 `ICCProfileName = "sRGB"` 正确写入，Worker 日志 `Detected color space: sRGB`

---

## Step 2：Wasm LibRaw — 浏览器端 RAW 解析（v3.1）

**核心目标**：在浏览器内用 Web Worker + WebAssembly 直接解析 RAW 文件二进制，输出 16-bit 线性 RGB 浮点数组，不依赖服务端二次转码。

### 技术方案

| 层 | 技术 | 说明 |
|----|------|------|
| 解析层 | [LibRaw](https://www.libraw.org/) 编译为 Wasm（Emscripten） | 去马赛克、白平衡、噪声抑制；输出 `Float32Array` |
| 线程隔离 | Web Worker | 不阻塞主线程，UI 保持响应 |
| 传输 | `transferable` ArrayBuffer | 零拷贝从 Worker 传递至主线程 |
| 触发时机 | 用户点击详情页时 | 按需加载 Wasm 模块（懒加载） |

### 前端修改点

- `frontend/src/lib/raw-worker.ts`（新建）：Wasm 加载 + `postMessage` 接口
- `frontend/src/components/PhotoDetail.tsx`：当 `photo.OriginalFilename` 为 RAW 扩展名时，触发 Worker 解析；解析完成前展示 WebP proxy 作为 placeholder
- `frontend/public/libraw.wasm`（构建产物）：Emscripten 编译输出

### 依赖与构建

```bash
# 编译 LibRaw 为 Wasm（在专用 Docker 构建环境中）
emcc libraw.cpp -O3 -s WASM=1 -s EXPORTED_FUNCTIONS='["_process_raw"]' -o libraw.js
```

- 构建产物放入 `frontend/public/`，Next.js 自动作为静态资源提供
- `frontend/package.json` 无需新增 npm 依赖（直接用 `fetch()` 加载 `.wasm`）

### 预期效果

- RAW 文件在浏览器端原生解析，16-bit 精度不经过服务端 8-bit 压缩
- 为后续 WebGL 渲染管线提供高精度输入数据

---

## Step 3：WebGL 实时色彩渲染管线（v3.2）

**核心目标**：将 Step 2 输出的浮点数组（或 proxy WebP）作为 GPU 纹理，在 Fragment Shader 中实时实现基础修图运算，达到 60fps 丝滑体验。

### 渲染架构

```
浮点数组 / WebP Texture
        ↓
WebGL2 TextureObject (RGBA16F)
        ↓
Fragment Shader Pipeline:
  → Linear decode (sRGB → Linear)
  → Exposure (stops)
  → Contrast (S-curve)
  → HSL (Hue/Saturation/Luminance)
  → Curves (Spline LUT)
  → Output gamma encode (Linear → sRGB / P3)
        ↓
Canvas 2D composite → 屏幕
```

### 修改点

| 文件 | 变更 |
|------|------|
| `frontend/src/lib/gl-renderer.ts`（新建） | WebGL2 context 初始化、shader 编译、纹理上传 |
| `frontend/src/lib/shaders/color.frag`（新建） | 核心 GLSL Fragment Shader（曝光/对比/HSL）|
| `frontend/src/components/PhotoDetail.tsx` | 将 `<Image>` 替换为 `<canvas>` + GL renderer |
| `frontend/src/components/AdjustPanel.tsx`（新建） | 滑块 UI（曝光、对比度、饱和度）|

### Shader 核心逻辑（伪代码）

```glsl
vec3 linear = pow(texture(u_image, v_texCoord).rgb, vec3(2.2)); // decode sRGB
linear *= pow(2.0, u_exposure);                                  // exposure
linear = applyContrast(linear, u_contrast);                      // S-curve
linear = applyHSL(linear, u_hue, u_saturation, u_luminance);    // HSL
vec3 out_color = pow(linear, vec3(1.0 / 2.2));                  // encode sRGB
gl_FragColor = vec4(out_color, 1.0);
```

### 注意事项

- WebGL2 兼容性：所有现代桌面浏览器均支持，移动端 iOS Safari 15+ 支持
- 无法使用 `next/image` 优化（canvas 不走 img 标签），需完全自控渲染
- 参数变更通过 `uniform` 传递，不重新上传纹理（避免帧率下降）

---

## Step 4：广色域与 HDR 显示支持（v3.3）

**核心目标**：检测用户显示器色域，动态选择输出色彩空间；应用 ACES 色调映射，将 HDR 内容正确压缩到可显示范围。

### 显示器色域检测

```typescript
const isP3 = window.matchMedia("(color-gamut: p3)").matches;
const isRec2020 = window.matchMedia("(color-gamut: rec2020)").matches;
const targetColorSpace: "srgb" | "display-p3" = isP3 ? "display-p3" : "srgb";
```

### ACES 色调映射（Fragment Shader）

```glsl
// ACES Filmic Tone Mapping (简化版)
vec3 aces_tonemap(vec3 x) {
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
```

### Wide Gamut P3 输出（Canvas 颜色空间）

```typescript
// 创建 P3 颜色空间 Canvas（Chrome 94+、Safari 15.2+）
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { colorSpace: "display-p3" });
```

### 修改点

| 文件 | 变更 |
|------|------|
| `frontend/src/lib/display-detect.ts`（新建） | 色域检测 hook，返回 `targetColorSpace` |
| `frontend/src/lib/shaders/tonemap.frag`（新建） | ACES / Reinhard 色调映射 shader |
| `frontend/src/components/PhotoDetail.tsx` | 将 `targetColorSpace` 传入 GL renderer |
| `frontend/src/components/ColorSpaceIndicator.tsx`（新建） | 右下角显示当前渲染色彩空间的小徽章 |

---

## Phase 3 版本规划摘要

| 版本 | Step | 核心交付 | 状态 |
|------|------|---------|------|
| v3.0 | Step 1 | ICC Profile 感知代理生成 + 色彩空间徽章 | ✅ 已完成 |
| v3.1 | Step 2 | Wasm LibRaw 浏览器端 RAW 解析 | ⏳ 待开始 |
| v3.2 | Step 3 | WebGL 实时渲染管线 + 基础修图滑块 | ⏳ 待开始 |
| v3.3 | Step 4 | 广色域 / HDR 显示 + ACES 色调映射 | ⏳ 待开始 |

---

## 技术风险与决策记录

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| LibRaw Wasm 包体积（~3MB+） | 首次加载慢 | 懒加载 + Service Worker 缓存 |
| iOS Safari WebGL2 限制 | 部分效果无法呈现 | 降级到 WebGL1 单 pass 渲染 |
| P3 Canvas 兼容性 | 旧浏览器无法输出 P3 | 检测后 fallback 到 sRGB Canvas |
| ACES 在 GLSL 中精度 | mediump 精度不足 | 强制使用 highp float |

---

## 与 Phase 4 的衔接

Phase 3 Step 3 完成后，WebGL 渲染管线中的修图参数（曝光/对比/曲线）将作为**导出参数**直接输入 Phase 4 的导出引擎，实现"所见即所得"的高自由度导出。

