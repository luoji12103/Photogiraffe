# Phase 21 Roadmap — 地图聚类 + 时间轴过滤 (v0.21)

**Date:** 2026-02-26  
**Status:** Planned  
**Priority:** Low-Medium

---

## 目标

优化现有地图页面，提升大量 GPS 标记时的性能和可读性，并新增按时间筛选的交互功能。

- **Marker 聚类**：使用 `leaflet.markercluster` 替代单点显示，支持缩放级别展开
- **时间轴过滤**：页面底部或侧边滑条，按拍摄日期范围动态筛选显示的照片点
- **热力图视图**：切换到热力图模式（`leaflet.heat`）展示拍摄密度分布
- **点击聚类**：点击聚类气泡展开成网格预览该位置的照片缩略图

---

## 版本规划

| 子版本 | 内容 | 涉及文件 |
|--------|------|----------|
| v0.21.1 | Go Core: GET /api/photos/map 增加 `start_date` / `end_date` 查询参数 | `go-core/main.go` |
| v0.21.2 | Frontend: 安装 `leaflet.markercluster` + 重写 PhotoMapLeaflet.tsx 聚类逻辑 | `frontend/src/components/PhotoMapLeaflet.tsx`, `package.json` |
| v0.21.3 | Frontend: 时间轴 range slider + 热力图切换 + 聚类弹窗网格 | `frontend/src/components/PhotoMapLeaflet.tsx` |
| v0.21.4 | 测试 + build + commit | `tests/integration_test.py` |

---

## 技术实现

### 依赖
```
leaflet.markercluster@^1.5.3
leaflet.heat@^0.2.0
@types/leaflet.markercluster（TypeScript 类型）
```

### 数据流
```
GET /api/photos/map?start_date=2024-01-01&end_date=2024-12-31
→ [{id, lat, lng, thumbnail, shot_at, title}, ...]

PhotoMapLeaflet receives points →
  if (mode === "cluster") → L.MarkerClusterGroup
  if (mode === "heat")    → L.heatLayer([[lat, lng, intensity], ...])
```

### 聚类弹窗
```
点击聚类 → spiderfy + 自定义 popup：
┌─ 该区域 5 张照片 ────────────────┐
│ [缩略图] [缩略图] [缩略图]       │
│ [缩略图] [缩略图]                │
└──────────────────────────────────┘
```

### 时间轴组件
```
[2022 ──────●───────────── 2025]
            ↑ 滑块可以左右拖动，更新 map 显示
```

---

## API 变更

`GET /api/photos/map` 新增可选参数：
- `start_date=YYYY-MM-DD`
- `end_date=YYYY-MM-DD`  
- `limit=500`（默认上限，防止大量点卡顿）

响应增加字段：`shot_at`（用于时间轴排序）
