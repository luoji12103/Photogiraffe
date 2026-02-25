# Phase 11 — 前端视觉与体验全面升级

> 日期：2026-02-25
> 前置：Phase 10 全部完成，128/128 测试通过

## 目标

将 Photogiraffe 前端从「功能可用但视觉单一」升级为「视觉精致、交互流畅」的专业摄影管理平台。

## Sub-versions

### v11.1 — 主题系统 + 设计 Tokens + 全局样式基础
- 创建 `ThemeContext.tsx`：dark/light 模式切换，持久化 localStorage
- 重写 `globals.css`：CSS 变量体系（颜色、间距、圆角、阴影），支持 dark/light
- `layout.tsx` 挂载 `<html class="dark">` 动态切换
- 所有组件统一使用语义化颜色变量（`bg-surface`, `text-primary` 等）

### v11.2 — 导航栏与侧边栏改版
- 桌面端：左侧固定侧边栏（可折叠），Logo + 主导航 + 用户区
- 移动端：底部导航栏（5 个核心入口）
- 活跃路由高亮（framer-motion underline indicator）
- 用户头像 + 快捷操作下拉

### v11.3 — 骨架屏 + 空状态 + 加载状态
- 通用 `Skeleton` 组件（圆形/矩形/文本行）
- 画廊空状态插画 + 引导上传 CTA
- 各页面统一使用骨架屏替代简单 spinner
- Toast 动画优化

### v11.4 — 画廊动画与页面过渡
- PhotoGrid 渐进 stagger 动画（卡片逐个浮入）
- 照片卡片 hover 效果升级（微位移 + 阴影 + EXIF 预览）
- 页面路由级 fade/slide 过渡（framer-motion AnimatePresence）

### v11.5 — 无限滚动分页
- IntersectionObserver 触底加载
- Go Core `/photos` 新增 `?page=&limit=` 分页参数
- 滚动位置恢复（返回画廊时保持位置）

## 约束
- 不修改 Go Core API 行为，仅新增分页 query param
- 集成测试保持 128/128 全通过
- 遵守 HANDOFF.md 全部关键约束
