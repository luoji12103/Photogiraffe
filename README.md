# Photogiraffe

一套面向摄影师的自托管照片管理平台，支持 RAW 文件上传与浏览器端解码、EXIF 数据提取、AI 图像分析与参数推断、高质量导出、预设管理，以及完整的多用户认证与权限控制。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| RAW 文件支持 | 基于 libraw-wasm 在浏览器端解码 RAW，支持 Sony ARW/HIF、Canon CR2/CR3、Nikon NEF 等主流格式 |
| EXIF 解析 | 上传后自动提取相机型号、镜头、焦距、光圈、快门速度、ISO、GPS、色彩空间等元数据 |
| WebGL 渲染 | 宽色域 / HDR 显示，可在 Display P3 / Adobe RGB 屏幕上呈现完整色彩 |
| 色调调整 | 亮度、对比度、饱和度、色温等参数实时预览 |
| AI 图像分析 | 接入 OpenAI / Google Gemini / Anthropic Claude 等多模态模型，生成照片分析报告 |
| AI 参数推断 | AI 根据照片风格自动推荐最优色调参数 |
| 导出引擎 | 支持 JPEG / WebP / PNG 格式导出，可控制质量与分辨率 |
| 预设管理 | 保存和复用色调参数预设 |
| 多用户认证 | JWT + Refresh Token 旋转，首位注册用户自动成为 SuperAdmin |
| 数据隔离 | 每位用户只能访问自己的照片与预设 |
| Feature Flags | 运行时开关，可在 Admin Panel 中一键启用/禁用各项功能 |
| Admin Panel | SuperAdmin 专属后台：Feature Flags 管理 + 用户列表 |

---

## 技术架构

```
浏览器
  └─▶ Next.js 前端 (port 3000)
         └─▶ Go Core API (port 8080，仅内网暴露)
                ├─▶ PostgreSQL (持久化)
                ├─▶ MinIO (原始文件 + 缩略图 + 导出文件存储)
                └─▶ Redis Streams (任务队列)
                         └─▶ Python Worker (图像处理 + AI 任务)
```

- **Go Core**: Fiber v2 + GORM，负责业务 API 与任务调度
- **Python Worker**: Pillow / pillow-heif / rawpy，负责 RAW 解码、缩略图生成、EXIF 提取、AI 接口调用
- **Next.js**: App Router，全 CSR 组件，通过 API Proxy 路由与 Go Core 通信

---

## 快速开始

### 前置要求

- [Docker](https://docs.docker.com/get-docker/) >= 24
- [Docker Compose](https://docs.docker.com/compose/) >= 2.20（通常随 Docker Desktop 一起安装）

### 1. 克隆仓库

```bash
git clone https://github.com/luoji12103/Photogiraffe.git
cd Photogiraffe
```

### 2. 配置环境变量

复制示例文件并修改密钥：

```bash
cp .env.example .env
```

> 如果没有 `.env.example`，直接创建 `.env`（参见下方[环境变量说明](#环境变量说明)）。

**最少需要修改以下三项**：

```dotenv
INTERNAL_SECRET=<随机字符串，建议 48+ 字符>
JWT_SECRET=<随机字符串，建议 32+ 字符>
```

### 3. 启动所有服务

```bash
docker compose up -d
```

首次启动会自动构建镜像（约 2–5 分钟），之后访问：

- **前端**: http://localhost:3000
- **MinIO 控制台**: http://localhost:9001（用户名/密码见 `.env` 中的 `MINIO_USER` / `MINIO_PASSWORD`）

### 生产部署

仓库现在额外提供了一个更偏生产用途的 Compose 文件：

```bash
docker compose -f docker-compose.production.yml up -d --build
```

它默认只公开 nginx，并把 MinIO 控制台、Prometheus、Jaeger 限制在 `127.0.0.1`。更完整的运维说明见 [docs/production.md](/root/code/Photogiraffe/docs/production.md)。

### 4. 注册第一个用户（SuperAdmin）

打开 http://localhost:3000，会自动跳转到注册页。

**第一个注册的用户**自动获得 `SuperAdmin` 角色，拥有所有管理权限。之后注册的用户为 `StandardUser`。

填写用户名、邮箱和密码（最少 8 位）完成注册后即可登录使用。

---

## 使用指南

### 上传照片

登录后，点击右上角「Upload」按钮，支持拖拽或点击选择文件批量上传。

**支持的格式**:

| 类型 | 格式 |
|------|------|
| RAW | ARW, HIF, HEIF, CR2, CR3, NEF, NRW, RAF, RW2, ORF, PEF, SRW, DNG |
| 标准 | JPEG, JPG, PNG, WebP, TIFF, TIF |

上传后系统自动：
1. 存入 MinIO 对象存储
2. 生成 WebP 缩略图与代理图
3. 提取 EXIF 元数据

### 查看照片

点击缩略图进入详情页，可查看：
- 高质量渲染图（WebGL，支持宽色域）
- 完整 EXIF 元数据
- 色调调整滑块（实时预览）

### AI 功能

> AI 功能需要先在「Settings」中配置 AI 服务商。

**AI 图像分析**：点击详情页「Analyze」按钮，AI 将生成对照片内容、构图、光线的分析报告。

**AI 参数推断**：点击「Infer Params」按钮，AI 根据照片风格推荐色调参数，可一键应用。

### 配置 AI（SuperAdmin）

访问 http://localhost:3000/settings（顶栏齿轮图标），填写：

| 字段 | 说明 |
|------|------|
| AI 服务商 | OpenAI / Google Gemini / Anthropic Claude / DeepSeek / MiniMax / 自定义 OpenAI 兼容端点 |
| 模型 | 从下拉列表或手动输入 |
| API Key | 对应服务商的 API Key |
| Base URL | 仅自定义兼容端点需要填写 |

### 导出照片

在照片详情页调整参数后，点击「Export」选择格式与质量。导出任务完成后会生成带时效的下载链接（15 分钟有效）。

### 预设管理

调整好参数后，点击「Save Preset」保存为预设，以便在其他照片上复用。

---

## Admin Panel（SuperAdmin 专属）

点击顶栏盾牌图标（🛡）访问 http://localhost:3000/admin。

### Feature Flags

可以在运行时启用/禁用各项功能，无需重启服务：

| Flag 名称 | 默认 | 说明 |
|-----------|------|------|
| `ai_analysis` | 关闭 | AI 图像分析 |
| `ai_infer_params` | 关闭 | AI 参数推断 |
| `export_engine` | 开启 | 导出引擎 |
| `preset_management` | 开启 | 预设管理 |
| `raw_decode` | 开启 | 浏览器端 RAW 解码 |
| `hdr_display` | 开启 | 宽色域 / HDR 渲染 |

### 用户管理

查看所有注册用户的 ID、用户名、邮箱、角色和注册时间。

---

## 环境变量说明

在项目根目录创建 `.env` 文件：

```dotenv
# ── 数据库 ───────────────────────────────────
DB_USER=postgres
DB_PASSWORD=<强密码>
DB_NAME=photogiraffe

# ── Redis ────────────────────────────────────
REDIS_PASSWORD=<强密码>

# ── MinIO 对象存储 ────────────────────────────
MINIO_USER=admin
MINIO_PASSWORD=<强密码，最少 8 位>

# ── 安全 ─────────────────────────────────────
# Go Core ↔ Python Worker 内部通信密钥（必填）
INTERNAL_SECRET=<随机字符串，48+ 字符>

# JWT 签名密钥（必填，生产环境务必修改）
JWT_SECRET=<随机字符串，32+ 字符>

# ── CORS ─────────────────────────────────────
# 允许访问 Go Core API 的前端来源
CORS_ALLOW_ORIGIN=http://localhost:3000
```

> **生成随机密钥**:
> ```bash
> openssl rand -hex 32   # JWT_SECRET
> openssl rand -hex 24   # INTERNAL_SECRET
> ```

---

## 常用命令

```bash
# 启动所有服务（后台）
docker compose up -d

# 启动生产配置
docker compose -f docker-compose.production.yml up -d --build

# 查看日志
docker compose logs -f go-core
docker compose logs -f frontend
docker compose logs -f python-worker

# 重启单个服务
docker compose restart go-core

# 重新构建并启动
docker compose up -d --build go-core frontend

# 停止并清除容器（保留数据卷）
docker compose down

# 完全重置（⚠ 删除所有数据）
docker compose down -v
```

## 质量检查

```bash
cd go-core && go test ./...
cd frontend && npm run lint && npm run typecheck
python -m py_compile python-worker/main.py test_exif.py tests/integration_test.py
```

---

## 系统要求

| 组件 | 最低建议 |
|------|---------|
| CPU | 2 核 |
| 内存 | 4 GB（AI 功能建议 8 GB） |
| 磁盘 | 20 GB（取决于照片数量） |
| 操作系统 | Linux / macOS / Windows（WSL2） |

---

## 服务端口一览

| 服务 | 宿主机端口 | 说明 |
|------|-----------|------|
| 前端 | 3000 | Next.js（对外暴露） |
| Go Core | 8080 | 仅 127.0.0.1（不对外） |
| MinIO 控制台 | 9001 | 对象存储管理界面 |
| PostgreSQL | 5432 | 仅 127.0.0.1 |
| Redis | 6379 | 仅 127.0.0.1 |

---

## 许可证

[MIT License](LICENSE)
