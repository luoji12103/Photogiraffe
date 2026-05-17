```markdown
# Phase 1 Step 5: 前端画廊基建 (Next.js + Tailwind)

## 目标
初始化前端项目，搭建基于 Next.js 和 Tailwind CSS 的基础画廊页面。实现与 Go Core API 的对接，获取已上传并处理完成的图片列表，并以网格布局展示缩略图。

## 预计修改方向
1. **Go Core API 增强**:
   - 在 `go-core/main.go` 中引入 Fiber 的 CORS 中间件，允许前端跨域请求。
   - 新增 `GET /photos` 接口，按上传时间倒序返回数据库中的照片列表。
2. **前端项目初始化**:
   - 在项目根目录创建 `frontend` 文件夹，初始化 Next.js (App Router) + TypeScript + Tailwind CSS 项目。
   - 创建 `frontend/Dockerfile`，用于容器化部署前端服务。
3. **基础设施更新**:
   - 修改 `docker-compose.yml`，加入 `frontend` 服务，映射端口 `3000`。
4. **画廊页面开发**:
   - 在 `frontend/src/app/page.tsx` 中实现基础的网格布局 (Masonry/Grid)。
   - 编写数据获取逻辑，调用 Go Core API 的 `/photos` 接口。
   - 拼接 MinIO 的访问 URL，展示图片的缩略图 (`thumb/` 路径)。

## 预期结果
执行 `docker-compose up -d --build` 后，前端服务将在 `http://localhost:3000` 启动。访问该地址可以看到之前上传的图片缩略图以网格形式展示。
```