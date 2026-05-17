# Phase 2 Step 2: 沉浸式照片详情页与高级动效 (Next.js + Framer Motion)

## 目标
实现符合“摄影设计美学”的前端展示。引入 `framer-motion` 动画库，实现从画廊网格到详情页的共享布局动画 (Shared Layout Animation)，并在详情页以高级感 UI 展示提取到的 EXIF 参数和色彩空间信息。

## 预计修改方向
1. **Go Core API 增强**:
   - 在 `go-core/main.go` 中新增 `GET /photos/:id` 接口，返回单张照片的详细信息，包括关联的 `ExifData`。
2. **前端依赖更新**:
   - 在 `frontend` 目录下安装 `framer-motion` 和 `lucide-react` (用于图标)。
3. **前端组件与页面开发**:
   - **画廊页面 (`frontend/src/app/page.tsx`)**:
     - 引入 `framer-motion` 的 `motion` 组件。
     - 为每个图片卡片添加 `layoutId`，以便实现共享布局动画。
     - 点击图片时，使用 Next.js 的 `useRouter` 或 `Link` 导航到详情页。
   - **详情页面 (`frontend/src/app/photo/[id]/page.tsx`)**:
     - 创建动态路由页面。
     - 获取单张照片及其 EXIF 数据。
     - 使用 `framer-motion` 实现图片的平滑放大过渡。
     - 设计一个侧边栏或悬浮层，优雅地展示相机型号、镜头、光圈、快门、ISO 等 EXIF 信息。

## 预期结果
用户在画廊页面点击一张图片后，图片会平滑地放大并过渡到详情页。详情页中不仅展示高分辨率的代理图，还会在一侧清晰地列出该照片的专业摄影参数。
