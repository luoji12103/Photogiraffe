# Phase 17 Roadmap — 感知哈希去重 (Perceptual Hash Deduplication)

**Date:** 2026-02-26  
**Status:** In Progress  
**Priority:** High (pHash deduplication from HANDOFF Phase 17 directions)

---

## 1. 目标 (Objectives)

实现基于感知哈希 (pHash) 的近似重复照片检测功能，使用户可以找到相似/重复照片并进行清理。

- **pHash 计算**：Python Worker 在上传时对缩略图计算 64-bit 感知哈希，存储为 16 位十六进制字符串
- **相似度计算**：Hamming 距离 ≤ 10（约 15% 位差异）视为近似重复
- **分组算法**：Union-Find（并查集），O(n²) 遍历用户所有带 pHash 的照片
- **前端展示**：专属"去重"页面，展示重复组，支持一键删除

---

## 2. 版本规划 (Version Plan)

| 版本 | 内容 | 涉及文件 |
|------|------|----------|
| v17.1 | Go Core: models.go 添加 PHash 字段 + 两个新端点 | `go-core/models/models.go`, `go-core/main.go` |
| v17.2 | Python Worker: 添加 imagehash 依赖 + pHash 计算步骤 | `python-worker/requirements.txt`, `python-worker/main.py` |
| v17.3 | Frontend: duplicates 代理路由 + 去重页面 + 导航栏 | `frontend/src/app/api/photos/duplicates/route.ts`, `frontend/src/app/duplicates/page.tsx`, `frontend/src/components/ClientLayout.tsx` |
| v17.4 | 测试 + git commit + HANDOFF 更新 | `tests/integration_test.py`, `HANDOFF.md` |

---

## 3. 技术实现细节 (Technical Details)

### 3.1 pHash 算法

采用 `imagehash` 库的 DCT-based 感知哈希：
- `imagehash.phash(image, hash_size=8)` → 64 bits
- 输出为 `ImageHash` 对象，`str()` 转换为 16 位十六进制字符串
- 相同 hash_size=8 → 8×8=64 bits → 16 hex chars

### 3.2 Hamming 距离

```go
import "math/bits"
dist := bits.OnesCount64(hashA ^ hashB)
// dist ≤ 10 → near-duplicate
```

阈值选择：64 bits 中 ≤10 位不同 ≈ 15.6% 差异，是业界常用近似重复阈值。

### 3.3 Union-Find 分组

```
For each pair (i, j): if hamming(i, j) <= 10 → union(i, j)
Group by root → filter groups with len >= 2
```

时间复杂度：O(n²) pair 检查，n = 用户含 pHash 照片数量。对普通用户（< 10k 张）完全可接受。

### 3.4 数据库字段

```go
// models.Photo
PHash *string `gorm:"type:varchar(16)"` // nullable; 64-bit pHash as 16-char hex
```

GORM AutoMigrate 会在 `photos` 表中添加 `p_hash` 列（varchar(16)，nullable）。

### 3.5 API 设计

```
PUT /internal/photos/:id/phash
  Header: X-Internal-Secret
  Body: {"phash": "a1b2c3d4e5f60718"}
  → 200: {"message": "pHash saved"}
  → 401: no secret
  → 400: bad body

GET /api/photos/duplicates
  Header: Authorization: Bearer <token>
  → 200: {"groups": [...], "total_groups": N}
  group: {"photos": [Photo, ...]}
```

---

## 4. 前端页面设计 (Frontend Page Design)

### `/duplicates` 页面特性：
- `AuthGuard` 保护
- 加载时调用 `/api/photos/duplicates`
- 每个重复组显示为卡片，标题 "重复组 #N (K 张)"
- 每组内照片以网格展示（缩略图）
- 每张照片可独立删除（与画廊相同的删除逻辑）
- 空状态：显示绿色图标 + "未发现重复照片"

### 导航栏：
在 ClientLayout.tsx 的 `NAV_ITEMS` 中，在"地图"后添加：
```tsx
{ href: "/duplicates", icon: Copy, label: "去重", mobile: false },
```

---

## 5. 测试用例 (Test Cases)

新增 `test_phase17(token)` 函数：

1. `GET /api/photos/duplicates` → 200, 返回 `groups` 数组
2. `PUT /internal/photos/1/phash` 无 secret → 403
3. `PUT /internal/photos/1/phash` 有 correct secret → 200 (或 404 不存在的 photo)

---

## 6. 变更清单 (Change Checklist)

- [x] 路由图文档创建
- [ ] `go-core/models/models.go` — 添加 `PHash *string`
- [ ] `go-core/main.go` — 添加 `math/bits` 导入 + 两个端点
- [ ] `python-worker/requirements.txt` — 添加 `imagehash`
- [ ] `python-worker/main.py` — 添加 `import imagehash` + pHash 计算步骤
- [ ] `frontend/src/app/api/photos/duplicates/route.ts` — 代理路由
- [ ] `frontend/src/app/duplicates/page.tsx` — 去重页面
- [ ] `frontend/src/components/ClientLayout.tsx` — 导航栏添加去重
- [ ] `tests/integration_test.py` — Phase 17 测试
- [ ] `git commit` — Phase 17 提交
- [ ] `HANDOFF.md` — 更新当前状态
