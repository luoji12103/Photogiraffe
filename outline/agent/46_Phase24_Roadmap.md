# Phase 24 Roadmap — PWA + 移动端优化 (v0.24)

**Date:** 2026-02-26  
**Status:** Planned  
**Priority:** Low

---

## 目标

将应用升级为完整 PWA（Progressive Web App），优化移动端体验，支持离线访问和安装到主屏幕。

- **Service Worker**：完善 `sw.js` 缓存策略（缓存前端资源，离线展示已访问照片）
- **Web App Manifest**：完善 `manifest.json`（图标、主题色、display mode、shortcuts）
- **安装提示**：检测 `beforeinstallprompt` 事件，在合适时机展示安装到主屏幕的引导
- **移动端手势**：照片详情页左右滑动切换上下一张照片
- **下拉刷新**：画廊首页和相册页实现 Pull-to-Refresh
- **底部导航优化**：移动端底部导航添加徽标计数（导出任务进行中等）
- **移动端摄像头上传**：直接从相机拍摄，通过 `accept="image/*;capture=camera"` 触发

---

## 版本规划

| 子版本 | 内容 | 涉及文件 |
|--------|------|----------|
| v0.24.1 | Service Worker 缓存策略 + Manifest 完善 | `frontend/public/sw.js`, `frontend/public/manifest.json` |
| v0.24.2 | 安装提示组件 + 移动端手势（左右滑切换照片）| `frontend/src/components/InstallPrompt.tsx`, `frontend/src/app/photo/[id]/page.tsx` |
| v0.24.3 | 下拉刷新 + 移动端相机上传 + 底部导航徽标 | `frontend/src/app/page.tsx`, `frontend/src/components/UploadPanel.tsx`, `frontend/src/components/ClientLayout.tsx` |
| v0.24.4 | 测试 + build + commit | — |

---

## 技术实现

### Service Worker 缓存策略

```javascript
// sw.js — Cache-First for static assets, Network-First for API
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;

// Static: Cache First (JS/CSS/fonts)
// Images (/api/image?path=...): Stale-while-revalidate，最大 200 张
// API (/api/*): Network First，失败时 fallback 到 cache
// Navigation: Network First，失败时 fallback 到 /offline
```

新增 `/offline` 页面：简单提示"您当前处于离线状态，已缓存照片仍可浏览"。

### Manifest 完善

```json
{
  "name": "Photogiraffe",
  "short_name": "Photogiraffe",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#09090b",
  "background_color": "#09090b",
  "orientation": "any",
  "shortcuts": [
    { "name": "上传照片", "url": "/?upload=1", "icons": [...] },
    { "name": "导出历史", "url": "/exports", "icons": [...] }
  ],
  "screenshots": [...]
}
```

### 照片详情手势切换

```typescript
// 在 photo/[id]/page.tsx 使用 touch events
const [touchStart, setTouchStart] = useState<number | null>(null);
// swipe left → next photo; swipe right → prev photo
// 需要 GET /api/photos?sort=date_desc 列表中找到前后 ID
```

### 下拉刷新

```typescript
// 使用 touch events 检测下拉距离
// 超过 60px 时显示刷新指示器并触发 reload
```

### 相机上传

```tsx
<input
  type="file"
  accept="image/*"
  capture="environment"  // 或 "user" 前置摄像头
/>
```

---

## 图标规范

需要在 `public/icons/` 提供：
- `icon-72x72.png`, `icon-96x96.png`, `icon-128x128.png`
- `icon-144x144.png`, `icon-152x152.png`, `icon-192x192.png`
- `icon-384x384.png`, `icon-512x512.png`
- `maskable-512x512.png`（用于自适应图标）

> 使用上次已有的 SVG giraffe logo 生成各尺寸，或在 build 时用 `sharp` 批量生成。

---

## 无新后端变更

此 Phase 完全是前端工作，不需要 Go Core 或 Python Worker 变更。
