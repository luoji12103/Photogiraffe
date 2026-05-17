# Phase 3 Step 1: 色彩空间感知代理生成 + 广色域展示

## 背景

Phase 2 已完整实现。当前状态：
- Python Worker 将所有图片（RAW / HEIF / JPEG）统一 `convert("RGB")` 后生成 WebP 代理图
- `ExifData` 已存储 `ColorSpace` 字段（值为 `"sRGB"` 或 `"Adobe RGB"` 等，由 exifread 提取）
- **问题**：`Pillow.Image.convert("RGB")` 不考虑 ICC Profile，对 Adobe RGB、Display P3 等宽色域图片会静默截断色彩空间，代理图实际以 sRGB 编码但颜色值有偏差；浏览器也无法区分图片的原始色彩空间

Phase 3 的目标是让 Photogiraffe 成为一个**色彩正确**的平台。Step 1 先夯实服务端的色彩感知能力，为后续 WebGL 渲染打基础。

## 目标

1. **色彩正确的代理图生成**：Python Worker 提取原图 ICC Profile，将其精确转换到 sRGB 后再生成 WebP（彻底解决 Adobe RGB 在浏览器显示偏色问题）
2. **ICC Profile 元数据持久化**：扩展 `ExifData` 表，存储 `ICCProfile`（profile 名称/类型）和 `OriginalColorSpace`（Adobe RGB / sRGB / Display P3 等）
3. **前端色彩空间徽章**：在照片详情页 EXIF 信息块中以带色彩的标签展示原始色彩空间，让用户知道这张图的色彩来源

## 具体修改方向

### 1. Python Worker 依赖更新 (`python-worker/requirements.txt`)
- 添加 `pillow[lcms2]`（或确保已启用 LittleCMS2 支持）用于 ICC Profile 转换
- 添加 `imageio`（可选，辅助宽色域图片读取）

### 2. Python Worker — 色彩正确的代理生成 (`python-worker/main.py`)

**核心逻辑改动** (在现有 `process_image` 中)：

```python
from PIL import Image, ImageCms

def convert_to_srgb(img: Image.Image) -> Image.Image:
    """
    将图片从其原始 ICC Profile 精确转换到 sRGB。
    如果无 ICC Profile 则假定已是 sRGB，直接返回。
    """
    # Try to get embedded ICC profile
    icc_raw = img.info.get("icc_profile")
    if not icc_raw:
        # No ICC, assume sRGB
        return img.convert("RGB") if img.mode != "RGB" else img

    try:
        src_profile = ImageCms.ImageCmsProfile(BytesIO(icc_raw))
        dst_profile = ImageCms.createProfile("sRGB")
        transform = ImageCms.buildTransformFromOpenProfiles(
            src_profile, dst_profile,
            img.mode, "RGB",
            renderingIntent=ImageCms.Intent.PERCEPTUAL
        )
        return ImageCms.applyTransform(img, transform)
    except Exception as e:
        logger.warning(f"ICC Profile conversion failed: {e}, falling back to convert()")
        return img.convert("RGB")
```

**ICC Profile 名称提取**：
```python
def get_icc_profile_name(img: Image.Image) -> str:
    icc_raw = img.info.get("icc_profile")
    if not icc_raw:
        return "sRGB"
    try:
        profile = ImageCms.ImageCmsProfile(BytesIO(icc_raw))
        return ImageCms.getProfileName(profile).strip()
    except:
        return "unknown"
```

修改 `process_image` 中：
- 将 `if img.mode != "RGB": img = img.convert("RGB")` 替换为 `img = convert_to_srgb(img)`
- 在 EXIF 提取阶段同时调用 `get_icc_profile_name(img)` 获取 `ICCProfileName`
- 将 ICC Profile 名称添加到 `exif_data` payload 中

### 3. Go Core — 扩展 ExifData 模型 (`go-core/models/models.go`)

```go
type ExifData struct {
    gorm.Model
    PhotoID          uint
    CameraModel      string
    LensModel        string
    FocalLength      string
    Aperture         string
    ShutterSpeed     string
    ISO              string
    ColorSpace       string  // 原始色彩空间（exifread 获取，如 "sRGB", "Adobe RGB (1998)"）
    ICCProfileName   string  // ICC Profile 名称（Python Pillow 解析，如 "Adobe RGB (1998)", "Display P3"）
    GPSLatitude      string
    GPSLongitude     string
    Software         string
    DateTimeOriginal string
}
```

`AutoMigrate` 会自动在 `exif_data` 表中添加 `icc_profile_name` 列（varchar，nullable）。

### 4. 前端 — 色彩空间徽章 (`frontend/src/components/PhotoDetail.tsx`)

在 EXIF 信息面板新增一个 **Color Space** 区域：

```tsx
// 色彩空间徽章颜色配置
const COLOR_SPACE_BADGE: Record<string, { bg: string; label: string }> = {
  "adobe rgb": { bg: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "Adobe RGB" },
  "display p3": { bg: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "Display P3" },
  "srgb": { bg: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "sRGB" },
};

// 在 EXIF 侧边栏中展示
{exif.ICCProfileName && (
  <div>
    <span className="text-xs text-zinc-500">Color Space</span>
    <ColorSpaceBadge name={exif.ICCProfileName} />
  </div>
)}
```

### 5. 前端 TypeScript 接口更新
- `ExifData` interface 中添加 `ICCProfileName?: string`
- `@modal/(.)photo/[id]/page.tsx` 和 `photo/[id]/page.tsx` 中的 `ExifData` interface 同步更新

## 测试计划

| 测试 | 方法 | 预期结果 |
|------|------|---------|
| T1 sRGB JPEG 上传 | 上传普通 sRGB JPEG | proxy 颜色正确，ICC 为 sRGB |
| T2 ARW 上传 | 上传 Sony RAW | ICCProfileName 显示相机原生色彩空间 |
| T3 Adobe RGB JPEG 上传 | 如有 Adobe RGB JPEG 测试 | proxy 精确转换至 sRGB，颜色无偏移 |
| T4 无 ICC Profile JPEG | 上传无嵌入ICC的JPEG | 降级为 convert("RGB")，不崩溃 |
| T5 前端徽章展示 | 点击进入详情页 | Color Space 徽章正确显示 |

## 预期效果

- 广色域原图（Adobe RGB / Display P3）的代理图色彩准确，浏览器可正确显示
- 照片详情页新增色彩空间徽章，清晰标识每张图片的原始色彩空间
- `exif_data` 表自动迁移，不需要手动执行任何 SQL
- 旧照片的 `icc_profile_name` 为空（NULL），UI 中静默忽略，不影响展示

## 不在本次范围
- 浏览器端 WebGL 色彩管理（Phase 3 Step 2）
- HDR / Tone Mapping（Phase 3 Step 3）
- LUT（Look-Up Table）应用
- Wide gamut 显示器检测

---

## Phase 3 全貌参考（见 09_Phase2_to_5_Roadmap.md）

| Step | 内容 | 复杂度 |
|------|------|--------|
| Step 1（本文档） | 色彩正确的代理生成 + 色彩空间徽章 | 中 |
| Step 2 | WebGL Fragment Shader 实时曝光/对比度/HSL 调整 | 高 |
| Step 3 | Wasm LibRaw 浏览器端 RAW 解析 + ACES Tone Mapping + HDR 显示器自适应 | 极高 |
