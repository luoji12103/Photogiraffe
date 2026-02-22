# Phase 3 Step 4: 广色域与 HDR 显示支持（v3.3）

## 背景

v3.2 已构建完整 WebGL 调整管线。当前所有输出均为标准 sRGB（8-bit），且不含高光保护。  
Phase 3 Step 4 的目标是在渲染管线中加入：  
1. 显示器色域检测（CSS media query API）  
2. ACES 电影色调映射（让高光优雅过渡，避免硬剪裁）  
3. `display-p3` Canvas 颜色空间输出（宽色域显示器原生支持）  
4. 右下角色彩空间指示器（ColorSpaceIndicator）

---

## 目标

| 目标 | 描述 |
|------|------|
| 显示检测 | 实时检测是否为 P3 / Rec.2020 / HDR 显示器，作为渲染策略依据 |
| ACES | 片段着色器中实现 ACES Filmic 曲线，作为可开关的 Tonemapping 模式 |
| P3 输出 | 广色域显示器时切换到 `colorSpace: "display-p3"` Canvas，扩大色彩范围 |
| ColorSpaceIndicator | 右下角小徽章，显示当前活跃的色彩空间（sRGB / P3） |

---

## 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `frontend/src/lib/display-detect.ts` | 新增 | CSS media query 色域/HDR 检测 Hook |
| `frontend/src/lib/gl-renderer.ts` | 修改 | Fragment Shader 增加 ACES 色调映射 uniform；支持 P3 Canvas |
| `frontend/src/components/ColorSpaceIndicator.tsx` | 新增 | 右下角显示当前渲染色彩空间 |
| `frontend/src/components/AdjustPanel.tsx` | 修改 | 新增 Tone Mapping 开关（ACES on/off） |
| `frontend/src/lib/gl-renderer.ts` 中 `AdjustParams` | 修改 | 新增 `tonemap: boolean` 字段 |
| `frontend/src/components/GLCanvas.tsx` | 修改 | 接收 `colorSpace` prop，传递给 canvas getContext |
| `frontend/src/components/PhotoDetail.tsx` | 修改 | 使用 `useDisplayDetect`，传 colorSpace 给 GLCanvas，显示 ColorSpaceIndicator |

---

## 核心设计

### `useDisplayDetect()` Hook

```typescript
// 返回值
{ isP3: boolean, isRec2020: boolean, prefersHDR: boolean }
```

- `isP3`: `window.matchMedia("(color-gamut: p3)").matches`  
- `isRec2020`: `window.matchMedia("(color-gamut: rec2020)").matches`  
- `prefersHDR`: `window.matchMedia("(dynamic-range: high)").matches`  
- 监听 `change` 事件，支持热插拔（连接外部显示器时）

### Fragment Shader 扩展（ACES）

在 v3.2 Fragment Shader 末尾，`linearToSrgb` 之前插入：

```glsl
uniform float u_tonemap; // 0.0 = off, 1.0 = ACES Filmic

vec3 aces_filmic(vec3 x) {
  float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Applied before linearToSrgb:
if (u_tonemap > 0.5) { linear = aces_filmic(linear); }
```

注意：GLSL 不支持 `if (uniform > 0.5)` 的 branch 需要用 `mix(linear, aces_filmic(linear), u_tonemap)` 避免 shader divergence。

### AdjustParams 新增字段

```typescript
export interface AdjustParams {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  tonemap: boolean;   // NEW: ACES filmic tone mapping
}
export const DEFAULT_ADJUST: AdjustParams = {
  ..., tonemap: false
};
```

### GLCanvas P3 支持

```typescript
// 当 colorSpace='display-p3' 时直接传入 getContext
const ctx = canvas.getContext("webgl2", { colorSpace: "display-p3" });
// 注：WebGL P3 canvas 在 Chrome 94+ Safari 15.2+ 可用，fallback 到 sRGB canvas
```

### ColorSpaceIndicator 位置

```
┌─────────────────────────────────────────────┐
│                                             │
│              [照片渲染区域]                  │
│                                           [Display P3 ●]  ← 右下角
└─────────────────────────────────────────────┘
```

---

## 测试计划

| 测试 | 方法 | 预期结果 |
|------|------|---------|
| T1 ACES 开关 | 打开详情 → 拖曝光至+2 → 开启 ACES | 高光区域从硬剪切变为平滑过渡 |
| T2 gamut 检测 | 控制台输出 isP3 值 | 宽色域显示器返回 true |
| T3 P3 canvas | 宽色域显示器开页面 | canvas colorSpace = "display-p3" |
| T4 ColorSpaceIndicator | 打开详情 | 右下角显示当前色彩空间 |
| T5 构建 | next build --webpack | 0 TypeScript 错误 |
