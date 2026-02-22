# Phase 6 Roadmap — Production Readiness & UX Enhancement

> 编写日期：2026-02-22
> 状态：In Progress

## 总览

Phase 6 目标将 Photogiraffe 从"功能完整"推向"生产就绪"。共分 5 个子版本，每个子版本独立deliverable并配有完整 log + commit。

---

## 子版本列表

| 版本 | 方向 | 文档 |
|------|------|------|
| v6.1 | 性能与体验（分页 / 搜索过滤 / 骨架屏 LazyLoad）| 30_Phase6_Step1_Plan.md |
| v6.2 | PWA / 移动端（Service Worker + manifest + 响应式）| 31_Phase6_Step2_Plan.md |
| v6.3 | 相册公开分享（ShareLink token，无需登录可访问）| 32_Phase6_Step3_Plan.md |
| v6.4 | 批量操作（多选 / 批量删除 / 批量导出）| 33_Phase6_Step4_Plan.md |
| v6.5 | 生产部署加固（Nginx + Rate Limiting + 邀请码注册）| 34_Phase6_Step5_Plan.md |

---

## 依赖关系

```
v6.1 → v6.2 → v6.3
                ↓
              v6.4
                ↓
              v6.5
```

实际上各步骤彼此独立，可并行，但按序实现以保证 Git 历史整洁。

---

## API 变更汇总（Phase 6 新增）

### v6.1
- `GET /photos?page=1&limit=20&search=&status=` — 分页+搜索+过滤
- `GET /photos/count` — 返回总数（前端分页用）

### v6.3
- `POST /api/photos/:id/share` — 创建分享链接（可选 expiry_hours）  
- `DELETE /api/photos/:id/share` — 撤销分享链接  
- `GET /share/:token` — 公开访问（无需 JWT），返回照片基本信息  
- `GET /share/:token/image` — 获取代理图预签名 URL

### v6.4
- `POST /api/photos/batch-delete` — 批量删除（body: `{ids:[1,2,3]}`）  
- `POST /api/photos/batch-export` — 批量导出（body: `{ids:[...], options:{...}}`）

### v6.5
- `POST /api/admin/invite-codes` — 生成邀请码（SuperAdmin）  
- `GET /api/admin/invite-codes` — 列出邀请码  
- `DELETE /api/admin/invite-codes/:code` — 撤销邀请码  
- `POST /api/auth/register` 新增 `invite_code` 字段（当 feature flag `require_invite` 开启时必填）

---

## 数据库变更汇总

### share_links（v6.3 新增）
| 列 | 说明 |
|----|------|
| photo_id | FK |
| user_id | 创建者 |
| token | 32字节 hex（uniqueIndex）|
| expires_at | nullable（NULL = 永不过期）|
| is_revoked | bool |

### invite_codes（v6.5 新增）
| 列 | 说明 |
|----|------|
| code | 8字符大写（uniqueIndex）|
| created_by | SuperAdmin user_id |
| used_by | nullable（已使用时填写）|
| is_used | bool |
| expires_at | nullable |
