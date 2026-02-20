# Photogiraffe - 最终实施蓝图与架构设计

## 1. 核心技术栈确认
- **前端 (Frontend)**: `Next.js` (React) + `Tailwind CSS` + `Framer Motion`。
- **后端核心 (Core API)**: `Go` (Fiber/Gin) + `GORM`。负责高并发 API、鉴权、数据库交互。
- **AI与图像微服务 (Worker)**: `Python` (FastAPI) + `PyTorch` + `OpenCV`。负责重度计算、AI 推理、复杂图像合成。
- **数据库**: `PostgreSQL` (存储用户、元数据、预设、功能开关)。
- **消息队列与缓存**: `Redis Streams` (Go 与 Python 之间的异步任务通信) + Redis Cache。
- **对象存储**: `MinIO` (兼容 S3，本地独立部署)。

## 2. 核心模块深度技术方案

### 2.1 极致视觉与高级色彩管理 (前端 WebGL 核心)
- **混合渲染架构 (Hybrid Wasm + WebGL)**: 
  - **Wasm (Web Worker)**: 引入编译为 Wasm 的 `LibRaw`。当用户在浏览器端打开 RAW 文件时，Wasm 在后台线程负责解析、去马赛克 (Demosaicing)，并输出 16-bit 线性 RGB 浮点数组。
  - **WebGL2/WebGPU**: 将浮点数组作为纹理上传至 GPU。所有的修图操作（曝光、对比度、HSL、曲线）全部在 **Fragment Shader (片段着色器)** 中实时计算，确保 60fps 的丝滑拖拽体验。
- **色彩空间与 HDR 映射**: 
  - 图像处理全程在**线性色彩空间 (Linear RGB)** 中进行。
  - 渲染管线的最后一步，Shader 会读取前端通过 `window.matchMedia('(color-gamut: p3)')` 探测到的显示器色域，并应用 ACES (Academy Color Encoding System) 电影级色调映射算法，将高动态范围 (HDR) 数据精准压缩并转换至 sRGB 或 Display P3，实现“所见即所拍”。

### 2.2 AI 赋能与参数反推 (Python 微服务核心)
- **AI 艺术解构**: Go API 接收前端请求，将图片 URL 和用户配置的动态 AI Base URL/Key 通过 Redis Stream 发送给 Python Worker。Python 调用多模态大模型 (如 GPT-4V/Gemini Pro Vision)，结合特定的 System Prompt（摄影史、构图学），返回结构化的艺术鉴赏 JSON。
- **修图参数反推 (Reverse Engineering)**: Python Worker 加载预训练的轻量级视觉回归模型 (基于 PyTorch)。输入原图与成片的差异张量，输出估算的 Lightroom/像素蛋糕 滑块参数，存入 PostgreSQL 并标记为“AI 自动反推”。

### 2.3 高自由度无损导出引擎
- **后端渲染管道**: 用户在前端配置导出参数（比例、分辨率、色彩空间、水印）。Go 将任务推入高优先级 Redis 队列。
- **精准合成**: Python Worker 接单，使用 `Pillow` 和 `OpenCV` 进行像素级重采样。支持将带 Alpha 通道的 PNG 签名/水印，以及 EXIF 数据，通过矩阵运算精准叠加在指定位置。最终生成包含正确 ICC Profile 的图像存入 MinIO。

### 2.4 架构演进与商业化预留
- **RBAC 与功能开关**: PostgreSQL 设计 `Users`, `Roles`, `Features` 表。所有高级功能（AI 降噪、批量导出）均受 API 网关的 Feature Flag 控制，为未来的 SaaS 化和付费解锁铺平道路。
- **跨端预留**: 核心业务逻辑全部下沉至 Go API 和 Python Worker，前端 Next.js 仅负责展示。未来可无缝接入 Tauri (桌面端) 或 React Native (移动端)。

---

## 3. Vibe Coding 阶段执行计划 (Phase 1: MVP)

**目标**: 跑通基础设施，实现高画质照片上传、色彩映射显示、EXIF 自动解析与基础画廊展示。

**Steps**
1. **基础设施编排**: 编写 `docker-compose.yml`，配置 `go-core`, `python-worker`, `postgres`, `redis`, `minio`。
2. **数据库初始化**: 在 Go 项目中设计并迁移基础表结构 (`User`, `Photo`, `ExifData`)。
3. **核心上传链路**: 
   - Go API 实现图片直传 MinIO 接口。
   - Go 解析基础 EXIF 数据并存入 PostgreSQL。
   - Go 向 Redis Stream 发布 `image_uploaded` 消息。
4. **Python 图像处理 Worker**: 
   - 监听 Redis Stream。
   - 接收任务后，从 MinIO 下载原图，使用 `Pillow`/`OpenCV` 生成包含正确 ICC Profile 的 WebP 代理图和缩略图，存回 MinIO。
   - 通过内部接口通知 Go 更新数据库状态。
5. **前端画廊基建**: 
   - 初始化 Next.js + Tailwind。
   - 实现类似高端画廊的非对称网格布局。
   - 封装基础的图片查看器组件，初步接入 Canvas/WebGL 以支持广色域图片的正确显示。

**Verification**
- 运行 `docker-compose up -d`，确保所有容器健康。
- 通过前端上传一张包含复杂 EXIF 和 Adobe RGB 配置文件的 JPEG/RAW 图片。
- 验证图片是否成功流转：Go -> MinIO -> Redis -> Python (生成代理图) -> MinIO -> Go (状态更新)。
- 验证前端画廊是否能正确读取 EXIF 并以正确的色彩空间渲染图片。

**Decisions**
- **前端重计算**: 确认采用 Wasm (LibRaw) + WebGL 的混合架构来实现浏览器端的 Camera Raw 体验，兼顾解析能力与渲染性能。
- **微服务通信**: 确认使用 Redis Streams 作为 Go 和 Python 之间的轻量级、高性能消息队列。