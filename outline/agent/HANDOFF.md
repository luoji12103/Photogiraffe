# Photogiraffe — 开发工作交接文档

> 编写时间：2026-02-21  
> 当前已交付至：**v3.0（Phase 3 Step 1）**  
> 下一步工作：**v3.1（Phase 3 Step 2 — Wasm LibRaw）**  
> 代码仓库：`luoji12103/Photogiraffe`，当前分支 `s4.6full-stack`

---

## 一、项目简介

Photogiraffe 是一个专为摄影师打造的**高画质个人影像管理平台**，核心特性：

- 支持 RAW（ARW/CR2/CR3/NEF 等）、HEIF（HIF）、JPEG 等格式上传
- 自动提取深度 EXIF 元数据（含 ICC Profile、GPS、相机/镜头）
- 多提供商 AI 摄影艺术分析（OpenAI、Google、Anthropic、ZhipuAI、DeepSeek、MiniMax）
- 色彩正确的 WebP 代理图生成（ICC sRGB 精确转换）
- Framer Motion 沉浸式画廊与详情页动画
- 拖拽上传面板，逐文件进度条

---

## 二、技术栈

| 层 | 技术 | 版本/备注 |
|----|------|---------|
| 前端 | Next.js App Router | 16+，TypeScript，Tailwind CSS v4 |
| 动画 | Framer Motion | Shared Layout Animation |
| 图标 | lucide-react | — |
| 后端 | Go + Fiber v2 | GORM，PostgreSQL 驱动 |
| 数据库 | PostgreSQL 15 | GORM AutoMigrate 管理 schema |
| 缓存/队列 | Redis 7 | Redis Streams（Go → Python 任务分发）|
| 对象存储 | MinIO | 单 bucket `photos`，私有访问 |
| 图像处理 | Python 3.12 + Pillow | pillow_heif、rawpy、exifread、ImageCms |
| AI SDK | Python | openai、google-generativeai、anthropic、zhipuai |
| 编排 | Docker Compose | 6 个服务 |

---

## 三、服务架构

```
浏览器 (port 3000)
  │
  ├─ GET /api/image?path=...   ──→  Next.js API Route (server-side proxy)
  ├─ POST /api/upload          ──→  (注入 ADMIN_TOKEN) ──→ Go Core :8080/upload
  ├─ GET /api/photos/[id]      ──→  Go Core :8080/api/photos/:id
  └─ POST /api/photos/[id]/analyze ──→ Go Core 触发 AI 分析

Go Core (:8080, 127.0.0.1 bound)
  │
  ├─ POST /upload              → MinIO (raw/ 路径) + Redis Stream (photogiraffe_tasks)
  ├─ GET  /api/photos          → PostgreSQL
  ├─ PUT  /internal/photos/:id/status   ← Python Worker 回调（需 X-Internal-Secret）
  └─ PUT  /internal/photos/:id/analysis ← Python Worker 回调

Python Worker (后台进程)
  │
  ├─ 监听 Redis Stream
  ├─ 下载 MinIO raw 原图
  ├─ 提取 EXIF + ICC Profile
  ├─ convert_to_srgb() → 生成 proxy（720p）+ thumbnail（400px）→ MinIO proxy/ 和 thumbnail/
  └─ 回调 Go Core /internal/ 更新状态和 EXIF

MinIO (internal only, port 9001 console external)
  └─ bucket: photos
       ├─ raw/          原始文件（RAW/HEIF/JPEG）
       ├─ proxy/        WebP 代理图（720p，色彩正确）
       └─ thumbnail/    WebP 缩略图（400px）
```

---

## 四、目录结构

```
/root/code/Photogiraffe/
├── docker-compose.yml          # 服务编排，含所有环境变量
├── frontend/                   # Next.js 16 App Router
│   ├── src/app/
│   │   ├── page.tsx            # 画廊首页（Server Component）含 UploadPanel
│   │   ├── @modal/             # Parallel Route — 截取路由画廊 modal
│   │   ├── photo/[id]/         # 直接访问照片详情页（fallback）
│   │   ├── settings/           # AI 配置设置页
│   │   └── api/
│   │       ├── upload/route.ts # 上传代理（注入 ADMIN_TOKEN）
│   │       ├── image/route.ts  # MinIO 图片代理（避免跨域）
│   │       ├── photos/[id]/route.ts
│   │       ├── photos/[id]/analyze/route.ts
│   │       └── config/ai/route.ts
│   └── src/components/
│       ├── PhotoGrid.tsx       # 画廊网格（Client Component）
│       ├── PhotoDetail.tsx     # 照片详情 + EXIF + AI 分析 + 色彩空间徽章
│       ├── ClientLayout.tsx    # 客户端布局包装（Framer Motion AnimatePresence）
│       └── UploadPanel.tsx     # 拖拽上传面板（XHR 进度）
├── go-core/
│   ├── main.go                 # Fiber 路由 + 中间件 + 业务逻辑（全部在单文件）
│   ├── models/models.go        # GORM 模型：User, Photo, ExifData, AIConfig, FeatureFlag
│   ├── database/db.go          # PostgreSQL 连接 + AutoMigrate
│   ├── storage/minio.go        # MinIO 客户端封装
│   └── queue/redis.go          # Redis Streams 生产者封装
├── python-worker/
│   ├── main.py                 # 任务消费主循环 + process_image()
│   └── requirements.txt
├── log/                        # 版本变更日志（见第六节）
└── outline/agent/              # 规划文档（见第七节）
```

---

## 五、环境变量总览（来自 docker-compose.yml）

| 变量 | 值 | 用途 |
|------|-----|------|
| `ADMIN_TOKEN` | `ba70b2df36501af4e15e04c695edd373a47e0c2dbe4f885d` | Go Core 外部 API 认证 |
| `INTERNAL_SECRET` | `d177805321d7f97e28e33f02ad1b02b174827feda71bfe5a` | Python Worker ↔ Go Core 内部通信 |
| `CORS_ALLOW_ORIGIN` | `http://localhost:3000` | Go Core CORS 白名单 |
| `POSTGRES_*` | db: `photogiraffe`, user: `postgres`, pass: `photogiraffe_db_pass` | PostgreSQL 连接 |
| `REDIS_ADDR` | `redis:6379` | Redis 地址（Docker 内网）|
| `MINIO_ENDPOINT` | `minio:9000` | MinIO 内网地址 |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO 认证 |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO 认证 |
| `INTERNAL_API_URL` | `http://go-core:8080` | Python Worker 和 Next.js 回调 Go Core |

---

## 六、数据库 Schema（关键表）

### `photos`
| 列 | 类型 | 说明 |
|----|------|------|
| ID | uint (PK) | — |
| OriginalFilename | string | 上传时文件名（含扩展名）|
| MinioPath | string | `raw/uuid.EXT` 格式 |
| Status | string | `processing` / `completed` / `failed` |
| UploadedAt | timestamp | — |
| AIAnalysis | jsonb (nullable `*string`) | JSON 字符串，NULL 直到 AI 分析完成 |

### `exif_data`
| 列 | 类型 | 说明 |
|----|------|------|
| PhotoID | uint (FK) | — |
| CameraModel | string | — |
| LensModel | string | — |
| FocalLength | string | — |
| Aperture | string | — |
| ShutterSpeed | string | — |
| ISO | string | — |
| ColorSpace | string | exifread 提取值（如 `"sRGB"`）|
| **ICCProfileName** | string | Pillow ImageCms 解析的 ICC 名（v3.0 新增）|
| GPSLatitude | string | — |
| GPSLongitude | string | — |
| Software | string | — |
| DateTimeOriginal | string | `YYYY:MM:DD HH:MM:SS` 格式 |

### `ai_configs`
| 列 | 类型 | 说明 |
|----|------|------|
| Provider | string | `openai` / `google` / `anthropic` / `zhipu` / `deepseek` / `minimax` / `openai_compatible` |
| BaseURL | string | openai_compatible 时必填 |
| APIKey | string | 明文存储（后续可加密）|
| ModelName | string | — |

---

## 七、已完成版本一览

| 版本 | log 文件 | outline 文件 | 核心内容 |
|------|----------|-------------|---------|
| v1.0 | `20260220_100000_v1.0.md` | `04_Phase1_Step1_Plan.md` | Docker Compose 基础设施 |
| v1.1 | `20260220_101500_v1.1.md` | `05_Phase1_Step2_Plan.md` | PostgreSQL Schema + GORM |
| v1.2 | `20260220_103000_v1.2.md` | `06_Phase1_Step3_Plan.md` | Go Core 上传链路 + MinIO + Redis |
| v1.3 | `20260220_110000_v1.3.md` | `07_Phase1_Step4_Plan.md` | Python Worker 图像处理 |
| v1.4 | `20260220_120000_v1.4.md` | `08_Phase1_Step5_Plan.md` | Next.js 画廊基础 UI |
| v2.0 | `20260220_120000_v2.0.md` | `10_Phase2_Step1_Plan.md` | EXIF 深度解析 + RAW 支持 |
| v2.1 | `20260220_121500_v2.1.md` | `11_Phase2_Step2_Plan.md` | 详情页 + Framer Motion 动画 |
| v2.1_debug~6 | `20260221_*_v2.1_debug*.md` | — | 7 次调试修复（含 JSONB 崩溃 B7）|
| v2.2 | `20260221_130000_v2.2.md` | `12_Phase2_Step3_Plan.md` + `13_Phase2_Step4_Plan.md` | 多提供商 AI 分析 |
| v2.3 | `20260221_143000_v2.3.md` | `14_Security_Hardening_Plan.md` | 安全加固（Token 认证、CORS、端口绑定）|
| v2.4 | `20260221_180000_v2.4.md` | `15_Phase2_Completion_UploadUI_Plan.md` | 拖拽上传 UI（Phase 2 完成）|
| **v3.0** | `20260222_100000_v3.0.md` | `16_Phase3_Step1_Plan.md` | ICC Profile 感知代理 + 色彩空间徽章 |

---

## 八、规划文档（outline/agent/）编号规范

| 编号 | 文件名规范 | 用途 |
|------|-----------|------|
| 03 | `03_Final_Implementation_Plan.md` | 整体架构蓝图（不修改）|
| 04-08 | `0N_Phase1_StepX_Plan.md` | Phase 1 各步骤 |
| 09 | `09_Phase2_to_5_Roadmap.md` | Phase 2-5 高层 Roadmap |
| 10-13 | `1N_Phase2_StepX_Plan.md` | Phase 2 各步骤 |
| 14 | `14_Security_Hardening_Plan.md` | 安全加固（非 Phase 步骤）|
| 15 | `15_Phase2_Completion_UploadUI_Plan.md` | Phase 2 补充（Upload UI）|
| 16 | `16_Phase3_Step1_Plan.md` | Phase 3 Step 1（v3.0 计划）|
| **17** | `17_Phase3_Roadmap.md` | **Phase 3 详细 Roadmap（新增）** |
| **18** | `18_Phase3_Step2_Plan.md` | **Phase 3 Step 2（v3.1 计划，新增）** |

**命名规则**：
- 新 step 计划：`{序号}_Phase{N}_Step{X}_Plan.md`
- 安全/专题：`{序号}_{主题}_Plan.md`
- Roadmap：`{序号}_Phase{N}_Roadmap.md`
- 序号连续递增，不跳号

---

## 九、版本日志（log/）命名规范

```
log/{YYYYMMDD}_{HHMMSS}_{版本号}.md
例：log/20260222_100000_v3.0.md
```

**格式模板**：
```markdown
# Photogiraffe {版本号} 变更日志

## 版本信息
- 版本：{N}
- 日期：{YYYY-MM-DD}
- 对应 Phase：Phase {N} Step {X}

## 变更内容

### 新增
- ...

### 修改
- ...

### 修复
- ...

## 修改的文件
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| ...  | 新增/修改 | ... |

## 验证结果
- ...

## 下一步计划
- {下一版本} 计划做...
```

---

## 十、开发流程规范

### 每次开发前必做

1. **阅读最新 log** 确认当前状态
2. **阅读对应 outline** 了解本次目标
3. 检查所有服务健康：`docker compose ps`

### 代码修改流程

1. 先修改非容器文件（models、前端组件）
2. 修改 Python Worker（`main.py`）
3. 重建：`docker compose build --no-cache {service1} {service2} && docker compose up -d`
4. 验证：查看 `docker logs {service}`，上传测试文件，检查 API 返回
5. 写 log 文件（详细记录修改内容 + 验证结果）

### 常用调试命令

```bash
# 查看服务状态
docker compose ps

# 实时日志
docker compose logs -f go-core
docker compose logs -f python-worker
docker compose logs -f frontend

# PostgreSQL 查询
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe -c "SELECT id, status, original_filename FROM photos ORDER BY id DESC LIMIT 5;"
docker exec photogiraffe-postgres psql -U postgres -d photogiraffe -c "SELECT photo_id, camera_model, icc_profile_name, color_space FROM exif_data ORDER BY id DESC LIMIT 3;"

# 上传测试文件
curl -X POST http://localhost:8080/upload \
  -H "Authorization: Bearer ba70b2df36501af4e15e04c695edd373a47e0c2dbe4f885d" \
  -F "image=@/path/to/file.HIF"

# 查询照片详情
curl http://localhost:8080/photos/{id} \
  -H "Authorization: Bearer ba70b2df36501af4e15e04c695edd373a47e0c2dbe4f885d"

# 重建单个服务
docker compose build --no-cache python-worker && docker compose up -d python-worker
```

---

## 十一、当前代码状态 & 关键逻辑位置

### `python-worker/main.py`（约 450 行）

| 函数/位置 | 说明 |
|---------|------|
| `get_icc_profile_name(img, is_raw)` | 提取 ICC 名（嵌入 ICC > NCLX > 默认 sRGB）|
| `convert_to_srgb(img)` | ICC 精确转换到 sRGB（Phase 3 Step 1 新增）|
| `process_image(photo_id, minio_path)` | 主处理函数（EXIF 提取 → ICC 转换 → 代理图生成）|
| `main()` 的 Redis 消费循环 | 监听 `photogiraffe_tasks` stream，`consumer_group` = `workers` |

**关键注意点**：
- HEIF 文件没有嵌入 ICC blob，走 NCLX profile 路径（`color_primaries=1` = sRGB）
- `features.check('lcms2')` 返回 False 是误报，`ImageCms` 实际功能正常（已验证）
- is_raw=True 时跳过 ICC 检测（rawpy 输出已是 sRGB 线性数据）

### `go-core/main.go`（约 350 行，单文件架构）

| 函数/中间件 | 说明 |
|------------|------|
| `requireAuth` | 检查 `Authorization: Bearer {ADMIN_TOKEN}` |
| `requireInternalSecret` | 检查 `X-Internal-Secret: {INTERNAL_SECRET}` |
| `POST /upload` | 接收文件 → MinIO → Redis Stream → 返回 photo_id |
| `PUT /internal/photos/:id/status` | Python Worker 回调，更新 status + exif_data（upsert）|
| `POST /api/photos/:id/analyze` | 触发 AI 分析，推入 Redis AI tasks stream |

**关键注意点**：
- `AIAnalysis` 是 `*string`（指针），NULL = 未分析，`""` 不会存入（避免 jsonb 崩溃）
- EXIF upsert 用 `FirstOrCreate + Save`，防止重复处理同一照片时插入重复行
- 所有端口绑定到 `127.0.0.1`（含 postgres:5432, redis:6379, go-core:8080）

### `frontend/src/components/PhotoDetail.tsx`

| 位置 | 说明 |
|------|------|
| `ExifData` interface（~L8）| 含 `ICCProfileName?: string` |
| `handleAnalyze()` | XHR 触发 AI 分析 + 3s 轮询 + 60s 超时 |
| `Palette` 色彩空间徽章（~L245）| IIFE 内联渲染，颜色按正则匹配 |
| `layoutId` 动画 | `photo-container-{id}` + `photo-image-{id}`（Shared Layout）|

### `frontend/src/components/UploadPanel.tsx`

| 函数 | 说明 |
|------|------|
| `uploadFile(item)` | XHR（非 fetch）上传，`xhr.upload.onprogress` 追踪进度 |
| `startUpload()` | 顺序上传（非并行），避免写入冲突 |
| `handleDone()` | 全部完成后调用 `router.refresh()` 刷新画廊 |

---

## 十二、已知限制 & 后续 TODOs

| 项目 | 当前状态 | 优先级 |
|------|---------|--------|
| S5 Redis Stream 中 API Key 明文 | 低优先级安全问题，记录在 v2.3 log | 低 |
| 旧照片 `icc_profile_name` 为 NULL | 不影响 UI（静默忽略） | 低 |
| AI 分析 Redis Stream Key 暴露 | 同 S5 | 低 |
| 多用户隔离 | Phase 5 负责 | 不在当前范围 |
| 浏览器端 WebGL 渲染 | Phase 3 Step 2/3 | **当前最高优先级** |

---

## 十三、下一步工作：v3.1（Phase 3 Step 2）

**目标**：Wasm LibRaw 浏览器端 RAW 解析  
**详细计划**：见 `outline/agent/18_Phase3_Step2_Plan.md`

**实施前检查清单**：
- [ ] 确认 `libraw-wasm` npm 包在 Node.js 18+ 可正常 install
- [ ] 确认 Next.js Webpack 支持 `new URL('…worker.ts', import.meta.url)` 语法（Next.js 14+ 原生支持）
- [ ] 确认 `/api/image?path=raw/...` 能正确代理 MinIO 中的 RAW 原始文件
- [ ] 测试文件：`/root/picture/A6704325.HIF`（Sony 相机，可用）

**预计修改文件**：
1. `frontend/package.json`：添加 `libraw-wasm`
2. `frontend/src/workers/raw-decoder.worker.ts`（新建）
3. `frontend/src/lib/useRawDecoder.ts`（新建）
4. `frontend/src/components/RawCanvas.tsx`（新建）
5. `frontend/src/components/PhotoDetail.tsx`：集成 Worker + 渐进加载
6. `frontend/next.config.ts`：Worker 配置（如需）
