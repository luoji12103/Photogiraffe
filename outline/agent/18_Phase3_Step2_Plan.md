# Phase 3 Step 2: Wasm LibRaw 浏览器端 RAW 解析（v3.1）

## 背景

Phase 3 Step 1（v3.0）已完成：
- Python Worker 正确提取 ICC Profile，精确转换宽色域图片至 sRGB
- `ExifData.ICCProfileName` 字段持久化，前端色彩空间徽章正常展示
- 代理图（WebP）在服务端已色彩正确地生成

**当前瓶颈**：浏览器端只能展示经过服务端压缩（8-bit WebP）的代理图。RAW 原始的 14-bit 线性浮点数据被永久丢弃，无法在浏览器内实现"所见即所拍"的渲染质量。

Phase 3 Step 2 的目标是：在浏览器端用 WebAssembly 直接解析 RAW 二进制，获取 16-bit 浮点像素数组，为后续 WebGL 实时渲染管线（Step 3）提供高精度输入。

---

## 目标

1. **Wasm 编译产物集成**：将预编译的 LibRaw Wasm 模块（或同等 JS 库）集成到 Next.js 项目
2. **Web Worker 隔离**：在独立线程中运行 RAW 解析，主线程的 UI 保持响应
3. **渐进式加载体验**：打开 RAW 照片详情时，立即显示 WebP proxy（快速），后台解析完毕后无缝替换为高精度渲染（高质量）
4. **内存管控**：大文件（>50MB ARW）分块传输，解析完毕后及时释放 Wasm heap

---

## 具体修改方向

### 1. 前端依赖 (`frontend/package.json`)

```bash
# 使用现有维护良好的 JS 绑定，而非自行编译 LibRaw（降低工程复杂度）
npm install libraw-wasm
```

`libraw-wasm` 提供了 LibRaw 的完整 Emscripten 绑定，包含去马赛克、白平衡、16-bit 输出，包体 ~2.8MB（gzip 后 ~900KB），支持 Next.js 动态 import。

### 2. Web Worker 包装器（新建 `frontend/src/workers/raw-decoder.worker.ts`）

```typescript
// Worker 运行在独立线程，不阻塞主线程
import LibRaw from "libraw-wasm";

let libraw: Awaited<ReturnType<typeof LibRaw>> | null = null;

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; photoId: number }>) => {
  if (!libraw) libraw = await LibRaw();

  const { buffer, photoId } = e.data;
  try {
    const raw = new libraw.RawProcessor();
    raw.open_buffer(new Uint8Array(buffer));
    raw.unpack();
    raw.dcraw_process();

    const image = raw.dcraw_make_mem_image();
    // image.data = Uint16Array (RGB interleaved, 16-bit linear)
    self.postMessage(
      { photoId, width: image.width, height: image.height, data: image.data.buffer },
      [image.data.buffer]   // transferable — 零拷贝
    );
    raw.recycle();
  } catch (err) {
    self.postMessage({ photoId, error: String(err) });
  }
};
```

### 3. Worker 管理 Hook（新建 `frontend/src/lib/useRawDecoder.ts`）

```typescript
import { useEffect, useRef, useState } from "react";

export interface RawFrame {
  width: number;
  height: number;
  data: ArrayBuffer; // RGB Uint16Array
}

export function useRawDecoder(photoId: number, rawUrl: string | null) {
  const workerRef = useRef<Worker | null>(null);
  const [frame, setFrame] = useState<RawFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rawUrl) return;

    setLoading(true);
    setError(null);

    // 动态创建 Worker（Next.js new URL + worker-loader）
    workerRef.current = new Worker(
      new URL("../workers/raw-decoder.worker.ts", import.meta.url)
    );

    workerRef.current.onmessage = (e) => {
      const msg = e.data;
      if (msg.error) {
        setError(msg.error);
      } else {
        setFrame({ width: msg.width, height: msg.height, data: msg.data });
      }
      setLoading(false);
    };

    // 通过 MinIO proxy 拉取原始 RAW 二进制
    fetch(rawUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        workerRef.current?.postMessage({ buffer: buf, photoId }, [buf]);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    return () => {
      workerRef.current?.terminate();
    };
  }, [photoId, rawUrl]);

  return { frame, loading, error };
}
```

### 4. 详情页集成（修改 `frontend/src/components/PhotoDetail.tsx`）

**渐进式加载逻辑**：

```tsx
const RAW_EXTENSIONS = new Set([".arw", ".cr2", ".cr3", ".nef", ".raw", ".dng", ".orf", ".raf", ".rw2", ".hif"]);
const ext = photo.OriginalFilename.split(".").pop()?.toLowerCase() ?? "";
const isRaw = RAW_EXTENSIONS.has(`.${ext}`);

// 原始 RAW 文件的代理路径（用于 Worker 抓取）
const rawProxyUrl = isRaw ? `/api/image?path=${encodeURIComponent(photo.MinioPath)}` : null;

const { frame, loading: rawLoading } = useRawDecoder(photo.ID, rawProxyUrl);

// 渲染时：frame 未就绪时用 <Image>（WebP proxy），就绪后用 <canvas>
```

PhotoDetail 展示层变更：
- 新增 `RawCanvas` 子组件（`frontend/src/components/RawCanvas.tsx`）：接收 `RawFrame`，将 `Uint16Array` 缩放渲染到 `<canvas>`（为 Step 3 WebGL 预留接口）
- `<Image>` 和 `<RawCanvas>` 通过 `frame` 是否存在切换，用 `AnimatePresence` 包裹过渡动画
- 右上角新增 "RAW" 质量标签（当 `rawLoading` 为 true 时显示旋转图标）

### 5. Next.js Worker 配置（修改 `frontend/next.config.ts`）

```typescript
const nextConfig: NextConfig = {
  webpack(config) {
    // 支持 *.worker.ts 被 webpack 内联为 Worker 入口
    config.module.rules.push({
      test: /\.worker\.ts$/,
      use: { loader: "worker-loader", options: { inline: "fallback" } },
    });
    return config;
  },
};
```

或者使用 Next.js 14+ 原生 `new URL(…, import.meta.url)` Worker 语法（更推荐，无需额外 loader）。

### 6. `/api/image` 路由扩展（修改 `frontend/src/app/api/image/route.ts`）

当前 `/api/image` 仅代理 MinIO 的 proxy/thumbnail WebP。需扩展支持代理 RAW 原始文件（Worker 抓取时使用同一路由）：

```typescript
// 支持查询参数 ?raw=1 直接代理 raw/ 路径的原始文件
const raw = searchParams.get("raw") === "1";
const effectivePath = raw ? path : path; // path 已包含 raw/ 前缀，逻辑不变
```

实际上由于现有路由直接转发 `path` 参数到 MinIO，此处可能无需修改——需在实施时验证。

---

## API 路由修复（`frontend/src/app/api/image/route.ts` 验证点）

| 验证项 | 期望 |
|--------|------|
| `GET /api/image?path=raw/xxx.arw` | 返回原始 RAW 二进制（`Content-Type: application/octet-stream`） |
| `GET /api/image?path=proxy/xxx.webp` | 返回 WebP 代理图（不变） |
| 大文件（50MB ARW） | 流式传输，无内存溢出 |

---

## 测试计划

| 测试 | 方法 | 预期结果 |
|------|------|---------|
| T1 WebP fallback | 打开普通 JPEG 详情 | 不触发 Worker，正常加载 WebP proxy |
| T2 RAW Worker 启动 | 打开 ARW 照片详情 | 控制台可见 Worker 消息，无主线程卡顿 |
| T3 渐进加载 | 打开 ARW 照片 | 先显示 WebP proxy，Worker 完成后切换为高精度 canvas |
| T4 内存释放 | 关闭详情页 | Worker 终止，Wasm heap 释放（DevTools Memory 无泄漏） |
| T5 大文件 50MB | 上传大 ARW 文件后打开详情 | 不崩溃，解析时间 <5s |
| T6 错误降级 | 上传损坏的 RAW 文件 | Worker 返回 error，继续显示 WebP proxy，不白屏 |

---

## 预期效果

- 用户打开 RAW 照片详情页：先看到 WebP 代理图（~100ms），2-4s 后自动切换为 16-bit 原始精度渲染
- 主线程在 Worker 解析期间保持 60fps 滚动
- 错误情况优雅降级，始终有画面显示

## 不在本次范围

- WebGL Fragment Shader（Step 3 负责）
- 修图滑块（Step 3 负责）
- Wasm 编译流程自动化（使用 libraw-wasm npm 包即可）
- 移动端适配

---

## Phase 3 当前进度参考

| 版本 | 内容 | 状态 |
|------|------|------|
| v3.0 | ICC Profile + 色彩空间徽章 | ✅ 已完成 |
| **v3.1** | **Wasm LibRaw 浏览器端解析（本步骤）** | ⏳ 待开始 |
| v3.2 | WebGL 实时渲染管线 | ⏳ 待开始 |
| v3.3 | 广色域 / HDR / ACES 色调映射 | ⏳ 待开始 |
