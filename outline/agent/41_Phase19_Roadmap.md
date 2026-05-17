# Phase 19 Roadmap — 导出历史管理页 (v0.19)

**Date:** 2026-02-26  
**Status:** Planned  
**Priority:** Medium

---

## 目标

提供独立的导出历史管理页面，让用户一眼看到所有导出任务的状态、下载成品、并清理旧记录。

- **全局导出列表**：`/exports` 页面，分页展示所有任务（含关联照片缩略图、状态、时间）
- **一键重新下载**：已完成任务显示下载按钮，获取预签名 URL
- **删除记录**：仅允许删除 `completed` / `failed` 状态的任务，同步清理 MinIO `exports/` 对象
- **状态过滤**：按 pending / processing / completed / failed 筛选
- **导航入口**：侧边栏新增"导出历史"入口

---

## 版本规划

| 子版本 | 内容 | 涉及文件 |
|--------|------|----------|
| v0.19.1 | Go Core: `GET /api/exports` + `DELETE /api/exports/:job_id` | `go-core/main.go` |
| v0.19.2 | Frontend: `/exports/page.tsx` + 代理路由 + 侧边栏导航 | `frontend/src/app/exports/page.tsx`, `frontend/src/app/api/exports/route.ts`, `frontend/src/components/ClientLayout.tsx` |
| v0.19.3 | 测试 + build + commit | `tests/integration_test.py` |

---

## API 设计

### GET /api/exports — 用户全部导出任务列表
```
Query: page=1&limit=20&status=completed|pending|processing|failed
Auth: Bearer JWT（当前用户的导出记录）
Response:
{
  "jobs": [
    {
      "ID": 42,
      "PhotoID": 7,
      "Status": "completed",
      "ExportOptions": {...},
      "OutputPath": "exports/...",
      "CreatedAt": "...",
      "UpdatedAt": "...",
      "photo_thumbnail": "proxy/xxx.webp"  // 联表获取
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

### DELETE /api/exports/:job_id — 删除导出记录
```
Auth: Bearer JWT（只能删自己的）
条件：Status == "completed" || Status == "failed"（pending/processing 不允许删）
副作用：如果 OutputPath 非空，删除 MinIO exports/ 对应文件
Response: 200 {"message":"deleted"} | 400/403/404
```

---

## 前端页面设计

```
/exports
┌─ 页头: 导出历史 + [状态筛选 Tab] ─────────────────────────┐
│ All │ Completed │ Processing │ Failed                    │
├───────────────────────────────────────────────────────────┤
│ [缩略图] 照片名.jpg   格式:JPEG 质量:90   2026-02-24      │
│          f/1.8  1/200                   ★ completed  ↓下载 │
│                                                      🗑删除 │
├───────────────────────────────────────────────────────────┤
│ [缩略图] 风景.ARW    格式:WebP 含边框    2026-02-23      │
│                                          ⏳ processing      │
└───────────────────────────────────────────────────────────┘
[← 上一页]   第 1/5 页   [下一页 →]
```

---

## 技术实现

### Go Core
1. `GET /api/exports` — GORM 联表查询：`export_jobs LEFT JOIN photos ON ...`，返回 photo thumbnail 字段
2. `DELETE /api/exports/:job_id` — 验证所属权 + 状态检查 + `storage.Client.RemoveObject(ctx, bucket, job.OutputPath)` + 软删除

### 前端
- `/exports/page.tsx`：使用 `authFetch`（CSR），状态 Tab 切换，分页，下载调用 `/api/exports/{id}/download`
- 代理路由：`/api/exports/route.ts`（GET）已存在需扩展；新增 DELETE 逻辑到 `/api/exports/[job_id]/route.ts`

---

## 依赖

- 无新依赖
- Go Core: `storage.Client.RemoveObject` 已有（MinIO SDK）
