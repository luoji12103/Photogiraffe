# Photogiraffe - Phase 2 to 5 Roadmap

## Phase 2: 摄影核心体验与 AI 鉴赏 (当前阶段)
**目标**: 解决“图片怎么看、怎么懂”的问题，打造极致的单图浏览体验和引入 AI 多模态能力。

*   **Step 1: 深度 EXIF 解析与元数据引擎 (Python + Go)**
    *   在图片处理阶段，提取专业的摄影参数（相机、镜头、光圈、快门、ISO、焦距、GPS、ICC Profile）。
    *   将元数据持久化到 PostgreSQL，并与照片记录关联。
*   **Step 2: 沉浸式照片详情页与高级动效 (Next.js + Framer Motion)**
    *   引入 `framer-motion` 动画库，实现从画廊网格到详情页的共享布局动画 (Shared Layout Animation)。
    *   在详情页以高级感 UI 展示 EXIF 参数和色彩空间信息。
*   **Step 3: 动态 AI 配置与底层接入 (Go + 数据库)**
    *   在数据库中设计表结构，允许存储加密的 AI Base URL、API Key 和模型名称。
    *   Go Core 提供相关的 CRUD API 供前端配置。
*   **Step 4: AI 艺术解构与摄影分析 (Python + 多模态大模型)**
    *   Go Core 新增触发 AI 分析的接口，将任务推入 Redis 队列。
    *   Python Worker 消费任务，读取用户的 AI 配置，调用多模态大模型（如 GPT-4o / Gemini 1.5 Pro）。
    *   结合摄影史、构图学、色彩心理学，让 AI 返回结构化的 JSON 数据（画面描述、构图分析、色彩情绪、艺术建议），并在前端展示。

## Phase 3: 极致视觉与色彩管理
**目标**: 实现浏览器端的专业级图像渲染。

*   **Step 1: Wasm LibRaw 接入**
    *   将 `LibRaw` 编译为 WebAssembly，在 Web Worker 中后台解析 RAW 文件，输出 16-bit 线性 RGB 浮点数组。
*   **Step 2: WebGL 实时色彩映射**
    *   将浮点数组作为纹理上传至 GPU，在 Fragment Shader 中实时计算修图操作（曝光、对比度、HSL、曲线）。
*   **Step 3: 广色域与 HDR 支持**
    *   探测显示器色域，应用 ACES 色调映射算法，将 HDR 数据精准压缩并转换至 sRGB 或 Display P3。

## Phase 4: 导出引擎与预设管理
**目标**: 提供高自由度的无损导出和预设分享功能。

*   **Step 1: 高自由度无损导出引擎 (Python OpenCV)**
    *   支持自定义分辨率规格、压缩等级、色彩格式。
    *   使用 OpenCV 进行像素级重采样，支持叠加带 Alpha 通道的 PNG 签名/水印和 EXIF 数据。
*   **Step 2: 预设管理与应用**
    *   支持用户上传和管理照片预设（Lightroom、像素蛋糕等）。
    *   在照片页面显示所用预设，提供下载和预览功能。
*   **Step 3: 修图参数反推 (AI 视觉回归模型)**
    *   输入原图与成片的差异张量，输出估算的滑块参数，存入数据库并标记为“AI 自动反推”。

## Phase 5: 商业化与多用户架构
**目标**: 完善系统架构，为未来的 SaaS 化和多用户社交平台做准备。

*   **Step 1: 完善用户鉴权 (JWT)**
    *   实现完整的注册、登录、Token 刷新流程。
*   **Step 2: RBAC 权限与多用户隔离**
    *   设计 `Users`, `Roles`, `Features` 表，实现基于角色的访问控制。
    *   确保用户只能访问和管理自己的照片和预设。
*   **Step 3: 功能开关 (Feature Flags) 与后台管理**
    *   实现全局功能开关，控制高级功能（如 AI 降噪、批量导出、自定义 AI API）的开启与关闭。
    *   开发后台管理面板，方便管理员进行统一设置。
