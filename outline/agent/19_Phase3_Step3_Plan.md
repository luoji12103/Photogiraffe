# Phase 3 Step 3: WebGL 实时色彩渲染管线（v3.2）

## 背景

v3.1 已实现浏览器端 Wasm LibRaw 解码，成功将 RAW 像素数据以 Uint8Array 形式输出到 `<canvas>`（`RawCanvas` 组件，基于 2D Context）。  
当前限制：  
- 2D Context 直接写 `putImageData` 无法接入 GPU 管线，无法实时调整参数
- 调整任何参数（曝光/对比度）需要在 CPU 上重新处理全帧数据（性能极差）
- WebP 代理图和 RAW canvas 是两套独立显示路径，无法统一调整

**Phase 3 Step 3 目标**：  
1. 构建 WebGL2 渲染器，将图像（RAW 像素或 WebP 代理）作为 GPU 纹理  
2. 在 GLSL Fragment Shader 中实时计算：曝光、对比度、饱和度、亮度  
3. 新增调整面板（滑块 UI），实现 60fps 实时预览  
4. 统一 RAW 和非 RAW 图像的显示路径

---

## 架构设计

```
PhotoDetail
  ├─ useRawDecoder()          → RawFrame | null
  ├─ GLCanvas (new)           → <canvas> with WebGL2
  │    ├─ useGLRenderer()     → manages WebGL lifecycle
  │    │    ├─ uploadTexture  ← RawFrame (Uint8Array) OR HTMLImageElement (WebP)
  │    │    └─ render(params) ← AdjustParams (uniforms)
  │    └─ AdjustPanel (new)   → sliders UI, emits AdjustParams
  └─ <Image> (fallback)       → when WebGL not supported
```

---

## 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `frontend/src/lib/gl-renderer.ts` | 新增 | WebGL2 渲染器类（shader 编译、纹理上传、uniform 更新、draw call）|
| `frontend/src/components/GLCanvas.tsx` | 新增 | 封装 WebGL canvas 为 React 组件，内嵌调整面板 |
| `frontend/src/components/AdjustPanel.tsx` | 新增 | 摄影参数调节滑块面板（曝光/对比度/饱和度/亮度）|
| `frontend/src/components/RawCanvas.tsx` | 删除 | 被 GLCanvas 取代 |
| `frontend/src/components/PhotoDetail.tsx` | 修改 | 用 `GLCanvas` 替换 `RawCanvas` + `<Image>` 双路径，统一展示 |

---

## 核心实现：`gl-renderer.ts`

### Vertex Shader（全屏四边形）
```glsl
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  v_texCoord.y = 1.0 - v_texCoord.y; // flip Y
  gl_Position = vec4(a_position, 0.0, 1.0);
}
```

### Fragment Shader（色彩调整管线）

```glsl
precision highp float;
uniform sampler2D u_image;
uniform float u_exposure;    // stops, -3.0 ~ +3.0
uniform float u_contrast;    // -1.0 ~ +1.0 (0 = no change)
uniform float u_saturation;  // 0.0 ~ 2.0 (1.0 = original)
uniform float u_brightness;  // -1.0 ~ +1.0 (0 = no change)
varying vec2 v_texCoord;

vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0/2.2)); }

void main() {
  vec4 color = texture2D(u_image, v_texCoord);
  vec3 linear = srgbToLinear(color.rgb);

  // Exposure (linear scale)
  linear *= pow(2.0, u_exposure);

  // Brightness (before contrast)
  linear = clamp(linear + u_brightness * 0.5, 0.0, 1.0);

  // Contrast (S-curve in linear space, around 0.18 midtone)
  linear = clamp(mix(vec3(0.18), linear, u_contrast + 1.0), 0.0, 1.0);

  // Saturation (luma-preserving)
  float luma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
  linear = mix(vec3(luma), linear, u_saturation);

  gl_FragColor = vec4(linearToSrgb(clamp(linear, 0.0, 1.0)), color.a);
}
```

### GLRenderer 类接口

```typescript
class GLRenderer {
  init(canvas: HTMLCanvasElement): boolean
  uploadFrame(frame: RawFrame): void          // from RAW decode
  uploadImage(img: HTMLImageElement): void    // from WebP proxy
  render(params: AdjustParams): void
  destroy(): void
  get isReady(): boolean
}
```

---

## AdjustParams 接口

```typescript
export interface AdjustParams {
  exposure: number;    // -3 ~ +3, default 0
  contrast: number;    // -1 ~ +1, default 0
  saturation: number;  // 0 ~ 2, default 1
  brightness: number;  // -1 ~ +1, default 0
}
export const DEFAULT_ADJUST: AdjustParams = { exposure:0, contrast:0, saturation:1, brightness:0 };
```

---

## AdjustPanel UI 设计

- 折叠面板（默认展开，可通过 `▼` 按钮收起）
- 4 个滑块，每个显示当前值
- 双击滑块 / 点击标签旁的重置按钮 → 恢复单项默认值
- 右上角 "Reset All" 按钮 → 一键恢复全部
- 样式延续 zinc 暗色系，字号小

---

## PhotoDetail 集成策略

**统一渲染路径**：所有图像（RAW / JPEG / HEIF）统一经过 GLCanvas 显示：

1. **初始状态**：WebP 代理图作为 HTMLImageElement 加载，GL纹理上传后立即展示
2. **RAW解码中**（若为RAW文件）：代理 WebP 在 GL 上展示，角标 "Decoding…"
3. **RAW解码完成**：用 RawFrame 替换 GL 纹理（质量提升，无闪烁）
4. **参数调整**：任何时刻都可以拖动滑块实时预览，requestAnimationFrame 驱动

**旧代码清理**：
- 移除 `<Image>` 直接展示路径
- 移除 `RawCanvas` 组件导入（文件删除）
- 移除 `AnimatePresence` 双层切换（改为 GL 内部纹理替换）

---

## WebGL 降级策略

若 `canvas.getContext('webgl2')` 返回 null（极少数浏览器）：
- 降级到 `webgl`（WebGL1，Fragment Shader 做细微调整）
- 若 WebGL1 也不支持：显示 `<img>` 静态代理图，隐藏 AdjustPanel，显示提示

---

## 测试计划

| 测试 | 预期结果 |
|------|---------|
| T1 打开 JPEG 详情 | GL canvas 正常显示 WebP 代理图 |
| T2 打开 RAW 详情 | 先显示 WebP→解码后 GL 纹理替换 |
| T3 拖动曝光滑块 | 实时 60fps 调整，无闪烁 |
| T4 点击 Reset All | 所有参数恢复默认 |
| T5 构建通过 | next build --webpack，0 TypeScript error |
