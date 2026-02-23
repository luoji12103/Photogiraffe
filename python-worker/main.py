import os
import re
import time
import logging
import json
import requests
import base64
from io import BytesIO
from PIL import Image, ImageCms
import numpy as np
import piexif
import redis
from minio import Minio
from pillow_heif import register_heif_opener
import exifread
import rawpy
from openai import OpenAI
import anthropic
from google import genai as google_genai
from google.genai import types as google_types
from zhipuai import ZhipuAI

register_heif_opener()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Color space helpers (Phase 3 Step 1) ─────────────────────────────────────

# NCLX color_primaries values (ISO 23091-2 / HEVC/HEIF)
_NCLX_PRIMARIES = {1: "sRGB", 9: "Rec. 2020", 12: "Display P3"}


def get_icc_profile_name(img: 'Image.Image', is_raw: bool = False) -> str:
    """
    Determine the color space name for a Pillow image.
    Priority: embedded ICC profile > HEIF NCLX profile > fallback 'sRGB'.
    """
    if is_raw:
        # rawpy postprocess outputs sRGB-like data; no ICC profile available.
        return "sRGB"

    # 1. Embedded ICC profile (present in JPEG from Lightroom / camera, TIFF)
    icc_raw = img.info.get("icc_profile")
    if icc_raw:
        try:
            profile = ImageCms.ImageCmsProfile(BytesIO(icc_raw))
            name = ImageCms.getProfileName(profile).strip()
            return name if name else "Unknown"
        except Exception:
            pass

    # 2. HEIF NCLX profile (pillow_heif exposes this)
    nclx = img.info.get("nclx_profile")
    if isinstance(nclx, dict):
        primaries = nclx.get("color_primaries", 0)
        return _NCLX_PRIMARIES.get(primaries, f"NCLX-{primaries}")

    return "sRGB"


def convert_to_srgb(img: 'Image.Image') -> 'Image.Image':
    """
    Convert image to sRGB using its embedded ICC profile.
    Handles CMYK, LAB, RGBA, and other modes gracefully.
    Falls back to Pillow's bare convert() if ImageCms fails.
    """
    # Strip alpha before ICC conversion (ICC profiles are RGB, not RGBA)
    if img.mode == "RGBA":
        img = img.convert("RGB")

    icc_raw = img.info.get("icc_profile")
    if not icc_raw:
        # No ICC profile — just ensure we're in RGB mode.
        return img if img.mode == "RGB" else img.convert("RGB")

    src_mode = img.mode if img.mode in ("RGB", "CMYK", "LAB", "YCbCr", "HSV") else "RGB"
    try:
        src_profile = ImageCms.ImageCmsProfile(BytesIO(icc_raw))
        dst_profile = ImageCms.createProfile("sRGB")
        transform = ImageCms.buildTransformFromOpenProfiles(
            src_profile, dst_profile,
            src_mode, "RGB",
            renderingIntent=ImageCms.Intent.PERCEPTUAL,
        )
        return ImageCms.applyTransform(img, transform)
    except Exception as e:
        logger.warning(f"ICC color conversion failed ({e}); using fallback convert()")
        return img.convert("RGB")

# Environment variables
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "redispass")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "admin12345")
GO_CORE_URL = os.getenv("GO_CORE_URL", "http://go-core:8080")
INTERNAL_SECRET = os.getenv("INTERNAL_SECRET", "")

# Provider default base URLs (for OpenAI-compatible providers)
# google / anthropic / zhipu use dedicated SDKs and do NOT need an entry here.
PROVIDER_BASE_URLS = {
    "openai":   "https://api.openai.com/v1",
    "kimi":     "https://api.moonshot.cn/v1",   # Kimi OpenAI-compatible endpoint
    "deepseek": "https://api.deepseek.com/v1",
    "minimax":  "https://api.minimax.chat/v1",
}

STREAM_NAME = "image_processing_queue"
AI_STREAM_NAME = "ai_analysis_queue"
EXPORT_STREAM_NAME = "export_queue"
INFER_STREAM_NAME = "infer_params_queue"
GROUP_NAME = "python_workers"
CONSUMER_NAME = "worker_1"

def init_redis():
    r = redis.Redis(host=REDIS_HOST, port=6379, password=REDIS_PASSWORD, decode_responses=True)
    try:
        r.xgroup_create(STREAM_NAME, GROUP_NAME, id="0", mkstream=True)
        logger.info(f"Created consumer group {GROUP_NAME} for stream {STREAM_NAME}")
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP Consumer Group name already exists" not in str(e):
            logger.error(f"Error creating consumer group: {e}")
            
    try:
        r.xgroup_create(AI_STREAM_NAME, GROUP_NAME, id="0", mkstream=True)
        logger.info(f"Created consumer group {GROUP_NAME} for stream {AI_STREAM_NAME}")
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP Consumer Group name already exists" not in str(e):
            logger.error(f"Error creating consumer group: {e}")

    try:
        r.xgroup_create(EXPORT_STREAM_NAME, GROUP_NAME, id="0", mkstream=True)
        logger.info(f"Created consumer group {GROUP_NAME} for stream {EXPORT_STREAM_NAME}")
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP Consumer Group name already exists" not in str(e):
            logger.error(f"Error creating consumer group: {e}")

    try:
        r.xgroup_create(INFER_STREAM_NAME, GROUP_NAME, id="0", mkstream=True)
        logger.info(f"Created consumer group {GROUP_NAME} for stream {INFER_STREAM_NAME}")
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP Consumer Group name already exists" not in str(e):
            logger.error(f"Error creating consumer group: {e}")
    return r

def init_minio():
    return Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False
    )

def process_image(minio_client, photo_id, minio_path):
    bucket_name = "photos"
    try:
        # 1. Download original image
        logger.info(f"Downloading {minio_path} from MinIO...")
        response = minio_client.get_object(bucket_name, minio_path)
        img_data = response.read()
        response.close()
        response.release_conn()

        # 2. Process image with Pillow or rawpy
        logger.info(f"Processing image {photo_id}...")
        
        is_raw = minio_path.lower().endswith(('.arw', '.cr2', '.nef', '.dng', '.raf'))
        
        if is_raw:
            logger.info("Detected RAW image, processing with rawpy...")
            try:
                with rawpy.imread(BytesIO(img_data)) as raw:
                    rgb = raw.postprocess(use_camera_wb=True, half_size=True)
                img = Image.fromarray(rgb)
            except Exception as e:
                logger.error(f"Failed to process RAW image with rawpy: {e}")
                raise e
        else:
            img = Image.open(BytesIO(img_data))
        
        # Extract EXIF data using exifread
        exif_data = {}
        try:
            tags = {}
            # Try parsing directly from file data (works for JPEG, TIFF, RAW)
            try:
                tags = exifread.process_file(BytesIO(img_data), details=False)
                logger.info(f"Tags from direct parse: {len(tags)}")
            except Exception as e:
                logger.info(f"Direct parse failed or returned empty: {e}")
            
            if not is_raw:
                logger.info(f"Pillow info keys: {list(img.info.keys())}")
            
            # If no tags found, try extracting from Pillow's info (works for HEIF/HIF)
            if not tags and not is_raw and 'exif' in img.info:
                logger.info("Trying to parse EXIF from Pillow info...")
                exif_bytes = img.info['exif']
                if isinstance(exif_bytes, bytes):
                    if exif_bytes.startswith(b'Exif\x00\x00'):
                        exif_bytes = exif_bytes[6:]
                    tags = exifread.process_file(BytesIO(exif_bytes), details=False)
                    logger.info(f"Tags from Pillow info: {len(tags)}")

            def get_tag(key):
                return str(tags[key]) if key in tags else ""

            if tags:
                exif_data = {
                    "CameraModel": get_tag("Image Model"),
                    "LensModel": get_tag("EXIF LensModel"),
                    "FocalLength": get_tag("EXIF FocalLength"),
                    "Aperture": get_tag("EXIF FNumber"),
                    "ShutterSpeed": get_tag("EXIF ExposureTime"),
                    "ISO": get_tag("EXIF ISOSpeedRatings"),
                    "ColorSpace": get_tag("EXIF ColorSpace"),
                    "GPSLatitude": get_tag("GPS GPSLatitude"),
                    "GPSLongitude": get_tag("GPS GPSLongitude"),
                    "Software": get_tag("Image Software"),
                    "DateTimeOriginal": get_tag("EXIF DateTimeOriginal")
                }
                logger.info(f"Extracted EXIF data: {exif_data}")
            else:
                logger.info("No EXIF tags found in the image.")
        except Exception as e:
            logger.warning(f"Failed to extract EXIF data: {e}")

        # Phase 3 Step 1: Determine ICC/color-space metadata before converting.
        # This must happen while 'img' still has its original info dict.
        icc_profile_name = get_icc_profile_name(img, is_raw)
        logger.info(f"Detected color space: {icc_profile_name}")
        if exif_data:
            exif_data["ICCProfileName"] = icc_profile_name
        else:
            exif_data = {"ICCProfileName": icc_profile_name}

        # Phase 3 Step 1: ICC-aware sRGB conversion.
        # Replaces the former bare `img.convert("RGB")` which silently dropped
        # wide-gamut (Adobe RGB / Display P3) colour information.
        img = convert_to_srgb(img)

        # Generate Proxy (max 2048px)
        proxy_img = img.copy()
        proxy_img.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        proxy_io = BytesIO()
        proxy_img.save(proxy_io, format="WEBP", quality=85)
        proxy_io.seek(0)
        proxy_path = minio_path.replace("raw/", "proxy/").rsplit(".", 1)[0] + ".webp"

        # Generate Thumbnail (max 512px)
        thumb_img = img.copy()
        thumb_img.thumbnail((512, 512), Image.Resampling.LANCZOS)
        thumb_io = BytesIO()
        thumb_img.save(thumb_io, format="WEBP", quality=80)
        thumb_io.seek(0)
        thumb_path = minio_path.replace("raw/", "thumb/").rsplit(".", 1)[0] + ".webp"

        # 3. Upload processed images back to MinIO
        logger.info(f"Uploading proxy to {proxy_path}...")
        minio_client.put_object(
            bucket_name, proxy_path, proxy_io, len(proxy_io.getvalue()), content_type="image/webp"
        )

        logger.info(f"Uploading thumbnail to {thumb_path}...")
        minio_client.put_object(
            bucket_name, thumb_path, thumb_io, len(thumb_io.getvalue()), content_type="image/webp"
        )

        # 4. Update status in Go Core API
        logger.info(f"Updating status for photo {photo_id} to completed...")
        update_url = f"{GO_CORE_URL}/internal/photos/{photo_id}/status"
        payload = {"status": "completed"}
        if exif_data:
            payload["exif_data"] = exif_data
        res = requests.put(update_url, json=payload, headers={"X-Internal-Secret": INTERNAL_SECRET})
        res.raise_for_status()

        logger.info(f"Successfully processed photo {photo_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to process image {photo_id}: {e}")
        # Try to update status to failed
        try:
            update_url = f"{GO_CORE_URL}/internal/photos/{photo_id}/status"
            requests.put(update_url, json={"status": "failed"}, headers={"X-Internal-Secret": INTERNAL_SECRET})
        except Exception as inner_e:
            logger.error(f"Failed to update status to failed: {inner_e}")
        return False

AI_ANALYSIS_PROMPT = """
You are an expert photography critic and art analyst. Analyze the provided image and return a JSON object with the following structure:
{
    "description": "A detailed description of the scene, subjects, and lighting.",
    "composition": "Analysis of the composition techniques used (e.g., rule of thirds, leading lines, framing).",
    "color_emotion": "Analysis of the color palette and the emotional impact or mood it conveys.",
    "artistic_advice": "Constructive feedback or suggestions for improvement from an artistic perspective."
}
Ensure the response is valid JSON only, no markdown fences.
"""

INFER_PARAMS_PROMPT = """You are an expert photo retouching AI. Analyze this photograph and suggest optimal colour adjustment parameters to make it visually appealing.

Return ONLY a JSON object with these exact keys (no explanation, no markdown fences):
{
  "exposure":   <float -3.0 to 3.0, typical -1 to 1>,
  "brightness": <float -1.0 to 1.0>,
  "contrast":   <float -1.0 to 1.0>,
  "saturation": <float 0.0 to 2.0, 1.0 = unchanged>,
  "tonemap":    <bool, true only if image looks significantly overexposed or HDR>
}"""


def _call_openai_compatible(base64_image: str, api_key: str, model_name: str, base_url: str) -> str:
    """OpenAI / DeepSeek / MiniMax / any OpenAI-compatible endpoint."""
    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model_name,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": AI_ANALYSIS_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{base64_image}"}},
            ],
        }],
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content


def _call_google(image_data: bytes, api_key: str, model_name: str) -> str:
    """Google Gemini via google-genai SDK (new API)."""
    client = google_genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model_name,
        contents=[
            google_types.Content(parts=[
                google_types.Part(text=AI_ANALYSIS_PROMPT),
                google_types.Part.from_bytes(data=image_data, mime_type="image/webp"),
            ])
        ],
        config=google_types.GenerateContentConfig(
            response_mime_type="application/json"
        ),
    )
    return response.text


def _call_anthropic(base64_image: str, api_key: str, model_name: str) -> str:
    """Anthropic Claude via anthropic SDK."""
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=model_name,
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/webp",
                        "data": base64_image,
                    },
                },
                {"type": "text", "text": AI_ANALYSIS_PROMPT},
            ],
        }],
    )
    return message.content[0].text


def _call_zhipu(base64_image: str, api_key: str, model_name: str) -> str:
    """ZhipuAI (GLM-4V) via zhipuai SDK."""
    client = ZhipuAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model_name,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{base64_image}"}},
                {"type": "text", "text": AI_ANALYSIS_PROMPT},
            ],
        }],
    )
    return response.choices[0].message.content


def process_ai_analysis(minio_client, photo_id, minio_path, provider, api_key, model_name, base_url=""):
    bucket_name = "photos"
    # Normalise provider; fall back to openai_compatible for legacy records
    if not provider:
        provider = "openai_compatible"

    try:
        logger.info(f"Starting AI analysis for photo {photo_id} via provider={provider}, model={model_name}...")

        # 1. Download proxy image from MinIO
        proxy_path = minio_path.replace("raw/", "proxy/").rsplit(".", 1)[0] + ".webp"
        response = minio_client.get_object(bucket_name, proxy_path)
        image_data = response.read()
        response.close()
        response.release_conn()

        # 2. Encode image to base64 (used by most providers)
        base64_image = base64.b64encode(image_data).decode("utf-8")

        # 3. Dispatch to provider SDK
        if provider == "google":
            analysis_result = _call_google(image_data, api_key, model_name)

        elif provider == "anthropic":
            analysis_result = _call_anthropic(base64_image, api_key, model_name)

        elif provider == "zhipu":
            analysis_result = _call_zhipu(base64_image, api_key, model_name)

        else:
            # openai | deepseek | minimax | openai_compatible
            effective_base_url = PROVIDER_BASE_URLS.get(provider, base_url)
            if not effective_base_url:
                raise ValueError(f"Provider '{provider}' requires a Base URL but none was provided.")
            analysis_result = _call_openai_compatible(base64_image, api_key, model_name, effective_base_url)

        logger.info(f"AI analysis completed for photo {photo_id}: {analysis_result}")

        # 4. Update result in Go Core API
        update_url = f"{GO_CORE_URL}/internal/photos/{photo_id}/analysis"
        res = requests.put(update_url, json={"analysis": analysis_result}, headers={"X-Internal-Secret": INTERNAL_SECRET})
        res.raise_for_status()

        logger.info(f"Successfully saved AI analysis for photo {photo_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to process AI analysis for photo {photo_id}: {e}")
        return False


def _apply_adjust_params(img: Image.Image, opts: dict) -> Image.Image:
    """
    Apply colour-adjustment parameters (mirroring the WebGL pipeline) via NumPy.
    Parameters come from the 'adjust' key in ExportOptions.
    """
    adjust = opts.get("adjust", {})
    exposure   = float(adjust.get("exposure",   0.0))
    brightness = float(adjust.get("brightness", 0.0))
    contrast   = float(adjust.get("contrast",   0.0))
    saturation = float(adjust.get("saturation", 1.0))
    tonemap    = bool(adjust.get("tonemap",     False))

    if exposure == 0 and brightness == 0 and contrast == 0 and saturation == 1.0 and not tonemap:
        return img  # no-op fast path

    img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32) / 255.0  # [0,1] sRGB

    # sRGB → linear
    linear = np.power(np.clip(arr, 1e-6, None), 2.2)

    # 1. Exposure (multiplicative, linear space, mirrors pow(2.0, u_exposure))
    linear *= (2.0 ** exposure)

    # 2. Brightness (additive offset, clamped [0,4])
    linear = np.clip(linear + brightness * 0.5, 0.0, 4.0)

    # 3. Contrast (pivot at 0.18 middle grey, mirrors mix(0.18, linear, contrast+1))
    linear = np.clip(0.18 + (contrast + 1.0) * (linear - 0.18), 0.0, 4.0)

    # 4. Saturation (Rec.709 luma-preserving mix)
    rec709 = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    luma = (linear * rec709).sum(axis=2, keepdims=True)
    linear = luma + saturation * (linear - luma)

    # 5. Optional ACES filmic tone mapping
    if tonemap:
        a, b, c2, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
        linear = np.clip((linear * (a * linear + b)) / (linear * (c2 * linear + d) + e), 0.0, 1.0)

    # linear → sRGB
    srgb_out = np.power(np.clip(linear, 1e-6, 1.0), 1.0 / 2.2)
    return Image.fromarray((srgb_out * 255).astype(np.uint8), mode="RGB")


def _apply_watermark(img: Image.Image, minio_client, watermark_path: str,
                     opacity: float, position: str) -> Image.Image:
    """Overlay a PNG watermark onto img. Returns original on any error."""
    try:
        resp = minio_client.get_object("photos", watermark_path)
        wm_data = resp.read()
        resp.close(); resp.release_conn()

        wm = Image.open(BytesIO(wm_data)).convert("RGBA")

        # Scale watermark to at most 25% of image long edge
        scale = min(1.0, (max(img.size) * 0.25) / max(wm.size))
        if scale < 1.0:
            new_w = int(wm.width * scale)
            new_h = int(wm.height * scale)
            wm = wm.resize((new_w, new_h), Image.LANCZOS)

        # Apply opacity via alpha channel
        r, g, b, a = wm.split()
        a = a.point(lambda x: int(x * opacity))
        wm.putalpha(a)

        # Determine position (bottom_right default)
        margin = 20
        iw, ih = img.size
        ww, wh = wm.size
        positions = {
            "bottom_right": (iw - ww - margin, ih - wh - margin),
            "bottom_left":  (margin, ih - wh - margin),
            "top_right":    (iw - ww - margin, margin),
            "top_left":     (margin, margin),
            "center":       ((iw - ww) // 2, (ih - wh) // 2),
        }
        pos = positions.get(position, positions["bottom_right"])

        out = img.convert("RGBA")
        out.paste(wm, pos, mask=wm)
        return out.convert("RGB")
    except Exception as e:
        logger.warning(f"Watermark overlay failed ({e}); skipping watermark")
        return img


def process_export_task(minio_client, job_id: str, photo_id: str, opts_json: str) -> bool:
    """
    Export pipeline:
      download → decode → adjust → resize → watermark → EXIF → upload → notify
    """
    bucket = "photos"
    try:
        opts = json.loads(opts_json) if opts_json else {}
        fmt        = opts.get("format",   "jpeg").lower()
        quality    = int(opts.get("quality",   85))
        long_edge  = int(opts.get("long_edge",  0))
        width      = int(opts.get("width",      0))
        height     = int(opts.get("height",     0))
        wm_path    = opts.get("watermark_path", "")
        wm_opacity = float(opts.get("watermark_opacity",  0.6))
        wm_pos     = opts.get("watermark_position", "bottom_right")
        embed_exif = bool(opts.get("embed_exif", True))

        # Mark job as processing
        _update_export_status(job_id, "processing")

        # 1. Fetch photo record from Go Core (to get minio_path)
        photo_res = requests.get(f"{GO_CORE_URL}/photos/{photo_id}", timeout=10)
        photo_res.raise_for_status()
        photo = photo_res.json()
        minio_path = photo["MinioPath"]

        logger.info(f"[export:{job_id}] Downloading {minio_path}...")
        response = minio_client.get_object(bucket, minio_path)
        img_data = response.read()
        response.close(); response.release_conn()

        # 2. Decode image
        is_raw = minio_path.lower().endswith(('.arw', '.cr2', '.cr3', '.nef', '.dng',
                                               '.raf', '.orf', '.rw2', '.hif'))
        if is_raw:
            with rawpy.imread(BytesIO(img_data)) as raw:
                rgb = raw.postprocess(use_camera_wb=True)
            img = Image.fromarray(rgb)
        else:
            img = Image.open(BytesIO(img_data))

        # Preserve original EXIF bytes for re-injection
        orig_exif_bytes = img.info.get("exif", None)

        img = img.convert("RGB")

        # 3. Apply colour adjustments (mirrors WebGL pipeline)
        img = _apply_adjust_params(img, opts)

        # 4. Resize
        iw, ih = img.size
        if long_edge > 0:
            scale = long_edge / max(iw, ih)
            if scale < 1.0:
                img = img.resize((int(iw * scale), int(ih * scale)), Image.LANCZOS)
        elif width > 0 and height > 0:
            img = img.resize((
                min(width,  8000),
                min(height, 8000)
            ), Image.LANCZOS)

        # 5. Watermark
        if wm_path:
            img = _apply_watermark(img, minio_client, wm_path, wm_opacity, wm_pos)

        # 6. Prepare output bytes
        out_buf = BytesIO()
        pil_fmt = {"jpeg": "JPEG", "jpg": "JPEG", "png": "PNG",
                   "webp": "WEBP", "tiff": "TIFF"}.get(fmt, "JPEG")
        save_kwargs: dict = {}

        if pil_fmt == "JPEG":
            save_kwargs["quality"]   = quality
            save_kwargs["subsampling"] = 0  # 4:4:4

            if embed_exif and orig_exif_bytes:
                try:
                    exif_dict  = piexif.load(orig_exif_bytes)
                    save_kwargs["exif"] = piexif.dump(exif_dict)
                except Exception as ex:
                    logger.warning(f"[export:{job_id}] EXIF re-injection failed: {ex}")
        elif pil_fmt == "PNG":
            save_kwargs["compress_level"] = max(0, min(9, 9 - quality // 11))
        elif pil_fmt == "WEBP":
            save_kwargs["quality"] = quality

        img.save(out_buf, format=pil_fmt, **save_kwargs)
        out_buf.seek(0)
        out_size = out_buf.getbuffer().nbytes

        # 7. Upload to MinIO under export/ prefix
        ext_map = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "TIFF": "tiff"}
        ext = ext_map.get(pil_fmt, "jpg")
        output_path = f"export/{job_id}.{ext}"
        content_type_map = {"JPEG": "image/jpeg", "PNG": "image/png",
                             "WEBP": "image/webp", "TIFF": "image/tiff"}
        content_type = content_type_map.get(pil_fmt, "application/octet-stream")

        minio_client.put_object(
            bucket, output_path, out_buf, out_size,
            content_type=content_type
        )
        logger.info(f"[export:{job_id}] Uploaded {output_path} ({out_size} bytes)")

        # 8. Notify Go Core of completion
        _update_export_status(job_id, "completed", output_path=output_path)
        return True

    except Exception as e:
        logger.error(f"[export:{job_id}] Export failed: {e}", exc_info=True)
        _update_export_status(job_id, "failed", error_message=str(e))
        return False


# ─── AI Parameter Inference ─────────────────────────────────────────────────

def _extract_json(text: str) -> str:
    """Extract first JSON object from LLM response (handles markdown fences)."""
    match = re.search(r'\{[^{}]+\}', text, re.DOTALL)
    if match:
        return match.group(0)
    return text  # Let json.loads raise on failure


def _call_openai_infer(base64_image: str, api_key: str, model_name: str, base_url: str) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model_name,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": INFER_PARAMS_PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{base64_image}"}},
        ]}],
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content


def _call_google_infer(image_data: bytes, api_key: str, model_name: str) -> str:
    client = google_genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model_name,
        contents=[google_types.Content(parts=[
            google_types.Part(text=INFER_PARAMS_PROMPT),
            google_types.Part.from_bytes(data=image_data, mime_type="image/webp"),
        ])],
        config=google_types.GenerateContentConfig(response_mime_type="application/json"),
    )
    return response.text


def _call_anthropic_infer(base64_image: str, api_key: str, model_name: str) -> str:
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=model_name, max_tokens=512,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/webp", "data": base64_image}},
            {"type": "text", "text": INFER_PARAMS_PROMPT},
        ]}],
    )
    return message.content[0].text


def process_infer_params_task(minio_client, photo_id: str, minio_path: str,
                               provider: str, api_key: str, model_name: str,
                               base_url: str = "") -> bool:
    """Analyse a photo via LLM and save suggested adjustment params to DB."""
    bucket_name = "photos"
    if not provider:
        provider = "openai_compatible"
    try:
        logger.info(f"[infer:{photo_id}] Starting param inference via {provider}/{model_name}...")
        response = minio_client.get_object(bucket_name, minio_path)
        image_data = response.read()
        response.close()
        response.release_conn()

        base64_image = base64.b64encode(image_data).decode("utf-8")

        if provider == "google":
            raw = _call_google_infer(image_data, api_key, model_name)
        elif provider == "anthropic":
            raw = _call_anthropic_infer(base64_image, api_key, model_name)
        else:
            effective_base_url = PROVIDER_BASE_URLS.get(provider, base_url)
            if not effective_base_url:
                raise ValueError(f"Provider '{provider}' requires a Base URL")
            raw = _call_openai_infer(base64_image, api_key, model_name, effective_base_url)

        params_json_str = _extract_json(raw)
        parsed = json.loads(params_json_str)

        # Ensure all required keys are present with safe defaults
        defaults = {"exposure": 0.0, "brightness": 0.0, "contrast": 0.0, "saturation": 1.0, "tonemap": False}
        for k, v in defaults.items():
            if k not in parsed:
                parsed[k] = v

        result_json = json.dumps(parsed)
        url = f"{GO_CORE_URL}/internal/photos/{photo_id}/inferred-params"
        res = requests.put(url, json={"inferred_params": result_json},
                           headers={"X-Internal-Secret": INTERNAL_SECRET}, timeout=10)
        res.raise_for_status()
        logger.info(f"[infer:{photo_id}] Saved inferred params: {result_json}")
        return True
    except Exception as e:
        logger.error(f"[infer:{photo_id}] Param inference failed: {e}", exc_info=True)
        return False


def _update_export_status(job_id: str, status: str,
                          output_path: str = "", error_message: str = "") -> None:
    url = f"{GO_CORE_URL}/internal/exports/{job_id}/status"
    payload = {"status": status}
    if output_path:
        payload["output_path"] = output_path
    if error_message:
        payload["error_message"] = error_message
    try:
        res = requests.put(url, json=payload,
                           headers={"X-Internal-Secret": INTERNAL_SECRET}, timeout=10)
        res.raise_for_status()
    except Exception as e:
        logger.warning(f"[export:{job_id}] Failed to update status to {status}: {e}")


def main():
    logger.info("Python Worker starting...")
    
    # Wait for services to be ready
    time.sleep(5)
    
    r = init_redis()
    minio_client = init_minio()

    logger.info("Python Worker started. Waiting for tasks...")
    while True:
        try:
            # Read from Redis Streams
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME,
                                    {STREAM_NAME: ">", AI_STREAM_NAME: ">",
                                     EXPORT_STREAM_NAME: ">", INFER_STREAM_NAME: ">"},
                                    count=1, block=5000)
            
            if not messages:
                continue

            for stream, message_list in messages:
                for message_id, message_data in message_list:
                    logger.info(f"Received task from {stream}: {message_id} -> {message_data}")
                    
                    if stream == STREAM_NAME:
                        photo_id = message_data.get("photo_id")
                        minio_path = message_data.get("minio_path")
                        
                        if photo_id and minio_path:
                            success = process_image(minio_client, photo_id, minio_path)
                            if success:
                                # ACK the message
                                r.xack(STREAM_NAME, GROUP_NAME, message_id)
                                logger.info(f"Acknowledged message {message_id}")
                        else:
                            logger.warning(f"Invalid message data: {message_data}")
                            r.xack(STREAM_NAME, GROUP_NAME, message_id)
                    
                    elif stream == AI_STREAM_NAME:
                        photo_id = message_data.get("photo_id")
                        minio_path = message_data.get("minio_path")
                        provider = message_data.get("provider", "openai_compatible")
                        base_url = message_data.get("base_url", "")
                        api_key = message_data.get("api_key")
                        model_name = message_data.get("model_name")
                        
                        if photo_id and minio_path and api_key and model_name:
                            success = process_ai_analysis(minio_client, photo_id, minio_path, provider, api_key, model_name, base_url)
                            if success:
                                # ACK the message
                                r.xack(AI_STREAM_NAME, GROUP_NAME, message_id)
                                logger.info(f"Acknowledged message {message_id}")
                        else:
                            logger.warning(f"Invalid message data for AI analysis: {message_data}")
                            r.xack(AI_STREAM_NAME, GROUP_NAME, message_id)

                    elif stream == EXPORT_STREAM_NAME:
                        job_id    = message_data.get("job_id")
                        photo_id  = message_data.get("photo_id")
                        opts_json = message_data.get("export_options", "{}")

                        if job_id and photo_id:
                            success = process_export_task(minio_client, job_id, photo_id, opts_json)
                        else:
                            logger.warning(f"Invalid export message data: {message_data}")
                            success = True  # ACK anyway to clear bad message

                        r.xack(EXPORT_STREAM_NAME, GROUP_NAME, message_id)
                        logger.info(f"Acknowledged export message {message_id} (success={success})")

                    elif stream == INFER_STREAM_NAME:
                        photo_id   = message_data.get("photo_id")
                        minio_path = message_data.get("minio_path")
                        provider   = message_data.get("provider", "openai_compatible")
                        base_url   = message_data.get("base_url", "")
                        api_key    = message_data.get("api_key")
                        model_name = message_data.get("model_name")

                        if photo_id and minio_path and api_key and model_name:
                            process_infer_params_task(minio_client, photo_id, minio_path,
                                                      provider, api_key, model_name, base_url)
                        else:
                            logger.warning(f"Invalid infer-params message data: {message_data}")

                        r.xack(INFER_STREAM_NAME, GROUP_NAME, message_id)
                        logger.info(f"Acknowledged infer-params message {message_id}")

        except Exception as e:
            logger.error(f"Error in worker loop: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()