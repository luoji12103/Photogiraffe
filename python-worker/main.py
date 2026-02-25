import os
import re
import time
import logging
import json
import zipfile
import requests
import base64
from io import BytesIO
from PIL import Image, ImageCms, ImageDraw, ImageFont
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
PROVIDER_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "minimax": "https://api.minimax.chat/v1",
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

        # Phase 13: Extract embedded XMP for IPTC copyright/creator metadata.
        # Scan raw bytes for <?xpacket XMP envelope present in JPEG/HEIF/DNG.
        xmp_copyright, xmp_creator = "", ""
        try:
            xmp_match = re.search(rb'<x:xmpmeta[\s\S]*?</x:xmpmeta>', img_data)
            if xmp_match:
                xmp_str = xmp_match.group(0).decode("utf-8", errors="ignore")
                # dc:rights — copyright
                cr = re.search(
                    r'<dc:rights[^>]*>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)</rdf:li>',
                    xmp_str,
                )
                if cr:
                    xmp_copyright = cr.group(1).strip()
                # dc:creator — photographer / artist
                au = re.search(
                    r'<dc:creator[^>]*>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)</rdf:li>',
                    xmp_str,
                )
                if au:
                    xmp_creator = au.group(1).strip()
                logger.info(f"XMP extracted — copyright: {xmp_copyright!r}, creator: {xmp_creator!r}")
        except Exception as e:
            logger.debug(f"XMP extraction skipped: {e}")

        if not exif_data:
            exif_data = {}
        if xmp_copyright:
            exif_data["Copyright"] = xmp_copyright
        if xmp_creator:
            exif_data["Creator"] = xmp_creator

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


# ─── Phase 14 helpers ────────────────────────────────────────────────────────

# Print spec aspect ratios (width:height)
_PRINT_SPEC_RATIOS = {
    "4x6":    (4, 6),
    "5x7":    (5, 7),
    "a4":     (210, 297),   # 1:√2
    "square": (1, 1),
}


def _crop_print_spec(img: "Image.Image", spec: str) -> "Image.Image":
    """Centre-crop img to match a print spec aspect ratio.
    Returns the original image unchanged when spec is 'none' or unknown.
    """
    if spec not in _PRINT_SPEC_RATIOS:
        return img
    rw, rh = _PRINT_SPEC_RATIOS[spec]
    iw, ih = img.size
    target_ratio = rw / rh
    current_ratio = iw / ih
    if abs(target_ratio - current_ratio) < 0.001:
        return img
    if current_ratio > target_ratio:
        # too wide — crop sides
        new_w = int(ih * target_ratio)
        left = (iw - new_w) // 2
        img = img.crop((left, 0, left + new_w, ih))
    else:
        # too tall — crop top/bottom
        new_h = int(iw / target_ratio)
        top = (ih - new_h) // 2
        img = img.crop((0, top, iw, top + new_h))
    return img


# ─── Phase 15 — Minimalist Frame Rendering Engine ────────────────────────────

# Canvas aspect-ratio targets (width:height float)
_CANVAS_RATIOS: dict[str, float] = {
    "original": 0.0,   # 0 = keep natural canvas from photo + margins
    "16:9":     16/9,
    "4:3":      4/3,
    "3:2":      3/2,
    "1:1":      1/1,
    "16:10":    16/10,
    "4:5":      4/5,
    "3:4":      3/4,
    "21:9":     21/9,
}

# Theme: bg_color, text_primary, text_secondary, divider_color, accent_color
_FRAME_THEMES: dict[str, dict] = {
    "white": {
        "bg":        (255, 255, 255),
        "primary":   (30,  30,  30),
        "secondary": (100, 100, 100),
        "divider":   (200, 200, 200),
        "accent":    (60,  60,  60),
    },
    "dark": {
        "bg":        (18,  18,  18),
        "primary":   (230, 230, 230),
        "secondary": (150, 150, 150),
        "divider":   (55,  55,  55),
        "accent":    (180, 180, 180),
    },
    "film": {
        "bg":        (245, 240, 230),   # aged ivory
        "primary":   (40,  30,  20),
        "secondary": (100, 86,  70),
        "divider":   (180, 160, 130),
        "accent":    (80,  60,  40),
    },
}

# Font search paths (Linux-first, then fallbacks)
_FONT_SEARCH_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "/usr/share/fonts/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
]
_FONT_BOLD_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
]


def _try_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Load a TrueType font at `size`; fall back to PIL default."""
    paths = _FONT_BOLD_PATHS if bold else _FONT_SEARCH_PATHS
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def _text_bbox(draw: ImageDraw.ImageDraw, text: str,
               font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    """Return (width, height) of text bounding-box."""
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0], bb[3] - bb[1]


def _fit_text(text: str, font: ImageFont.FreeTypeFont,
              max_w: int, draw: ImageDraw.ImageDraw) -> str:
    """Truncate text with ellipsis to fit within max_w pixels."""
    if not text:
        return ""
    w, _ = _text_bbox(draw, text, font)
    if w <= max_w:
        return text
    while text:
        text = text[:-1]
        w, _ = _text_bbox(draw, text + "…", font)
        if w <= max_w:
            return text + "…"
    return "…"


def _wrap_text(text: str, font: ImageFont.FreeTypeFont,
               max_w: int, draw: ImageDraw.ImageDraw,
               max_lines: int = 3) -> list[str]:
    """Break text into wrapped lines (word-wrap + hard-wrap fallback)."""
    if not text:
        return []
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        test = (cur + " " + word).strip()
        w, _ = _text_bbox(draw, test, font)
        if w <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
                if len(lines) >= max_lines:
                    break
            # word alone might still be too wide: hard-break
            while word:
                test = word
                w, _ = _text_bbox(draw, test, font)
                if w <= max_w:
                    cur = test
                    break
                word = word[:-1]
            else:
                cur = ""
    if cur and len(lines) < max_lines:
        lines.append(cur)
    return lines[:max_lines]


def _fetch_photo_meta(photo_id) -> dict:
    """Fetch full photo metadata from Go Core internal endpoint."""
    try:
        r = requests.get(
            f"{GO_CORE_URL}/internal/photos/{photo_id}/meta",
            headers={"X-Internal-Secret": INTERNAL_SECRET},
            timeout=8,
        )
        if r.ok:
            return r.json()
    except Exception as ex:
        logger.debug(f"[frame] meta fetch failed: {ex}")
    return {}


def _render_frame(
    img: Image.Image,
    meta: dict,
    opts: dict,
) -> Image.Image:
    """
    Phase 15: Render a minimalist frame around `img`.

    Steps:
      1. Select theme (white / dark / film)
      2. Collect text content rows
      3. Compute font sizes proportional to the image's short edge
      4. Measure total info-bar height
      5. Build natural canvas (photo + outer margins + info bar)
      6. Expand canvas to match target ratio if requested
      7. Paste photo, draw divider, render text rows
    """
    theme_name   = opts.get("frame_style", "white")
    target_ratio_key = opts.get("frame_ratio", "original")
    show_exif    = bool(opts.get("frame_show_exif", True))
    show_desc    = bool(opts.get("frame_show_desc", True))
    show_ai      = bool(opts.get("frame_show_ai",   False))
    theme = _FRAME_THEMES.get(theme_name, _FRAME_THEMES["white"])

    photo_w, photo_h = img.size
    short_edge = min(photo_w, photo_h)

    # ── Font sizes (2.2 / 1.75 / 1.4 % of short edge, minimum 14/12/11 px) ──
    sz_primary   = max(14, int(short_edge * 0.022))
    sz_secondary = max(12, int(short_edge * 0.0175))
    sz_caption   = max(11, int(short_edge * 0.014))

    # ── Outer margin = 4.5% of short edge, minimum 24 px ──
    margin = max(24, int(short_edge * 0.045))

    # ── Temporary draw surface for text measurement ──
    probe = Image.new("RGB", (photo_w * 4, photo_h * 2), theme["bg"])
    draw_probe = ImageDraw.Draw(probe)
    font_bold    = _try_font(sz_primary,   bold=True)
    font_regular = _try_font(sz_secondary, bold=False)
    font_small   = _try_font(sz_caption,   bold=False)
    line_gap_primary   = max(6, int(sz_primary   * 0.45))
    line_gap_secondary = max(4, int(sz_secondary * 0.4))
    line_gap_caption   = max(3, int(sz_caption   * 0.4))

    # ── Info area available width = photo_w – if landscape, else side column ──
    # Determine layout: portrait photo in wider canvas → side-by-side; else bottom bar
    photo_ratio = photo_w / photo_h
    target_ratio_val = _CANVAS_RATIOS.get(target_ratio_key, 0.0)
    # Side layout when: photo is portrait AND target canvas is landscape
    use_side_layout = (photo_ratio < 0.85) and (
        target_ratio_val >= 1.2 or target_ratio_key in ("16:9", "4:3", "3:2", "16:10", "21:9")
    )

    if use_side_layout:
        # side column width = 30–35% of target canvas width
        # We'll compute final canvas size first, then use column width
        if target_ratio_val > 0:
            canvas_w = int((photo_h + 2 * margin) * target_ratio_val)
        else:
            canvas_w = photo_w + margin * 4  # no target: add generous side space
        canvas_h = photo_h + 2 * margin
        side_col_w = canvas_w - photo_w - margin * 3
        info_max_w = max(100, side_col_w - margin)
    else:
        info_max_w = photo_w - 2  # preserve small inner padding
        side_col_w = 0

    # ── Collect text content lines ──
    camera = meta.get("camera_model", "").strip()
    lens   = meta.get("lens_model",   "").strip()
    ap     = meta.get("aperture",     "").strip()
    ss     = meta.get("shutter_speed","").strip()
    iso    = meta.get("iso",          "").strip()
    fl     = meta.get("focal_length", "").strip()
    dt_raw = meta.get("date_time_original", "").strip()
    desc   = meta.get("description",  "").strip()
    ai_raw = meta.get("ai_analysis",  "").strip()
    copyright_ = meta.get("copyright","").strip()
    creator    = meta.get("creator",  "").strip()

    # Format date
    date_str = ""
    if dt_raw:
        try:
            date_str = dt_raw[:10].replace(":", "/")
        except Exception:
            date_str = dt_raw[:10]

    # Build primary identifier (camera · lens)
    primary_parts = [p for p in [camera, lens] if p]

    # Build EXIF param tokens
    exif_tokens = []
    if show_exif:
        if ap:  exif_tokens.append(f"f/{ap}" if not ap.startswith("f") else ap)
        if ss:  exif_tokens.append(ss if "/" in ss or "s" in ss.lower() else f"{ss}s")
        if iso: exif_tokens.append(f"ISO {iso}" if not iso.upper().startswith("ISO") else iso)
        if fl:  exif_tokens.append(fl if "mm" in fl.lower() else f"{fl}mm")
    exif_line = "  ·  ".join(exif_tokens)

    # AI first sentence
    ai_line = ""
    if show_ai and ai_raw:
        # Strip JSON wrapper if present
        clean = re.sub(r'^\s*\{.*?"summary"\s*:\s*"', '', ai_raw)
        clean = re.sub(r'"\s*\}.*$', '', clean, flags=re.DOTALL)
        sent = re.split(r'[。.\n]', clean.strip())[0].strip()
        ai_line = sent[:120]

    # Copyright row (right-aligned)
    cr_parts = [p for p in [copyright_, creator] if p]
    copyright_line = "© " + "  ·  ".join(cr_parts) if cr_parts else ""

    # ── Measure and build rows for bottom or side layout ──
    def build_info_rows(avail_w: int):
        rows = []  # list of (text, font, color, indent)
        # Primary: camera / lens bold
        if primary_parts:
            for part in primary_parts:
                t = _fit_text(part, font_bold, avail_w, draw_probe)
                rows.append((t, font_bold, theme["primary"], 0))
        # EXIF param line
        if exif_line:
            t = _fit_text(exif_line, font_regular, avail_w, draw_probe)
            rows.append((t, font_regular, theme["secondary"], 0))
        # Date
        if date_str:
            rows.append((date_str, font_small, theme["secondary"], 0))
        # Description (wrapped)
        if show_desc and desc:
            wrapped = _wrap_text(desc, font_small, avail_w, draw_probe, max_lines=3)
            for line in wrapped:
                rows.append((line, font_small, theme["accent"], 0))
        # AI line
        if ai_line:
            t = _fit_text(f"AI  {ai_line}", font_small, avail_w, draw_probe)
            rows.append((t, font_small, theme["secondary"], 0))
        return rows

    info_rows = build_info_rows(info_max_w)

    # ── Compute info bar height ──
    def rows_height(rows) -> int:
        h = 0
        for _, font, _, _ in rows:
            _, fh = _text_bbox(draw_probe, "Ag", font)
            if font is font_bold:
                h += fh + line_gap_primary
            elif font is font_regular:
                h += fh + line_gap_secondary
            else:
                h += fh + line_gap_caption
        return h

    info_h = rows_height(info_rows)
    if copyright_line:
        _, cr_fh = _text_bbox(draw_probe, copyright_line, font_small)
        info_h += cr_fh + line_gap_caption * 2
    divider_thick = max(1, int(short_edge * 0.002))
    divider_gap   = max(6, int(short_edge * 0.012))

    # ── Build natural canvas size ──
    if use_side_layout:
        nat_w = canvas_w
        nat_h = canvas_h
    else:
        nat_w = photo_w + 2 * margin
        bar_h = divider_gap + divider_thick + divider_gap + info_h + margin
        nat_h = photo_h + margin + bar_h + margin

    # ── Expand to target ratio ──
    target_r = _CANVAS_RATIOS.get(target_ratio_key, 0.0)
    if target_r > 0:
        nat_ratio = nat_w / nat_h
        if nat_ratio < target_r:
            # expand width
            new_w = int(nat_h * target_r)
            extra_w = new_w - nat_w
            nat_w = new_w
        else:
            # expand height — push bottom (more info space)
            new_h = int(nat_w / target_r)
            nat_h = new_h

    canvas = Image.new("RGB", (nat_w, nat_h), theme["bg"])
    draw = ImageDraw.Draw(canvas)

    # ── Place photo ──
    if use_side_layout:
        photo_x = margin
        photo_y = margin
    else:
        photo_x = (nat_w - photo_w) // 2
        photo_y = margin
    canvas.paste(img, (photo_x, photo_y))

    # ── Draw divider ──
    if use_side_layout:
        # vertical divider between photo and side column
        div_x = photo_x + photo_w + divider_gap
        draw.rectangle(
            [div_x, margin, div_x + divider_thick, photo_y + photo_h],
            fill=theme["divider"]
        )
        text_x = div_x + divider_thick + divider_gap
        text_y = margin
    else:
        # horizontal divider below photo
        div_y = photo_y + photo_h + divider_gap
        draw.rectangle(
            [margin, div_y, margin + photo_w, div_y + divider_thick],
            fill=theme["divider"]
        )
        text_x = margin
        text_y = div_y + divider_thick + divider_gap

    # ── Draw info rows ──
    avail_text_w = (nat_w - text_x - margin) if use_side_layout else info_max_w
    rebuilt_rows = build_info_rows(avail_text_w)   # re-fit with final width

    cy = text_y
    for text, font, color, _ in rebuilt_rows:
        if not text:
            continue
        draw.text((text_x, cy), text, font=font, fill=color)
        _, fh = _text_bbox(draw, "Ag", font)
        if font is font_bold:
            cy += fh + line_gap_primary
        elif font is font_regular:
            cy += fh + line_gap_secondary
        else:
            cy += fh + line_gap_caption

    # ── Copyright (bottom-right) ──
    if copyright_line:
        _, cr_fh = _text_bbox(draw, copyright_line, font_small)
        cr_x = nat_w - margin - _text_bbox(draw, copyright_line, font_small)[0]
        cr_y = nat_h - margin - cr_fh
        draw.text((cr_x, cr_y), copyright_line, font=font_small, fill=theme["secondary"])

    del draw_probe
    return canvas


# ─── Phase 14 album export ────────────────────────────────────────────────────

def process_album_export(minio_client, job_id: str, album_id: str, opts_json: str) -> bool:
    """Phase 14: export all photos in an album as ZIP or PDF."""
    opts: dict = {}
    try:
        opts = json.loads(opts_json)
    except Exception:
        pass

    fmt        = opts.get("format", "zip").lower()          # zip | pdf
    quality    = max(1, min(100, int(opts.get("quality", 85))))
    print_spec = opts.get("print_spec", "none")
    album_name = opts.get("album_name", f"album-{album_id}")
    bucket     = "photos"

    logger.info(f"[album-export:{job_id}] album={album_id} fmt={fmt} spec={print_spec}")

    try:
        _update_export_status(job_id, "processing")

        # 1. Fetch photo list from internal endpoint
        res = requests.get(
            f"{GO_CORE_URL}/internal/albums/{album_id}/photos",
            headers={"X-Internal-Secret": INTERNAL_SECRET},
            timeout=15,
        )
        res.raise_for_status()
        photos = res.json().get("photos", [])

        if not photos:
            raise ValueError("album has no completed photos")

        logger.info(f"[album-export:{job_id}] {len(photos)} photos to process")

        if fmt == "pdf":
            output_path = _album_to_pdf(
                minio_client, job_id, album_id, album_name, photos,
                quality, print_spec, bucket
            )
        else:
            output_path = _album_to_zip(
                minio_client, job_id, album_id, album_name, photos,
                quality, print_spec, bucket
            )

        _update_export_status(job_id, "completed", output_path=output_path)
        logger.info(f"[album-export:{job_id}] done → {output_path}")
        return True

    except Exception as e:
        logger.error(f"[album-export:{job_id}] failed: {e}", exc_info=True)
        _update_export_status(job_id, "failed", error_message=str(e))
        return False


def _download_photo_for_export(minio_client, minio_path: str, quality: int, print_spec: str, bucket="photos") -> bytes:
    """Download a completed proxy image, apply print-spec crop, and return JPEG bytes."""
    # Use proxy path (already processed, sRGB)
    proxy_path = minio_path.replace("raw/", "proxy/").rsplit(".", 1)[0] + ".webp"
    try:
        resp = minio_client.get_object(bucket, proxy_path)
        img_data = resp.read()
        resp.close()
        resp.release_conn()
    except Exception:
        # Fall back to raw if proxy missing
        resp = minio_client.get_object(bucket, minio_path)
        img_data = resp.read()
        resp.close()
        resp.release_conn()

    img = Image.open(BytesIO(img_data)).convert("RGB")
    if print_spec != "none":
        img = _crop_print_spec(img, print_spec)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=quality, subsampling=0)
    return buf.getvalue()


def _album_to_zip(minio_client, job_id, album_id, album_name, photos, quality, print_spec, bucket) -> str:
    """Package all album photos into a ZIP and upload to MinIO."""
    zip_buf = BytesIO()
    safe_name = re.sub(r'[^\w\-]', '_', album_name)[:40]

    with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in photos:
            try:
                jpg_bytes = _download_photo_for_export(
                    minio_client, p["minio_path"], quality, print_spec, bucket
                )
                base_name = p["original_filename"].rsplit(".", 1)[0] + ".jpg"
                zf.writestr(base_name, jpg_bytes)
                logger.debug(f"[album-export:{job_id}] packed {base_name}")
            except Exception as e:
                logger.warning(f"[album-export:{job_id}] skipping {p.get('photo_id')}: {e}")

    zip_bytes = zip_buf.getvalue()
    output_path = f"export/album-{album_id}-{job_id}.zip"
    minio_client.put_object(
        bucket, output_path, BytesIO(zip_bytes), len(zip_bytes),
        content_type="application/zip"
    )
    logger.info(f"[album-export:{job_id}] ZIP uploaded ({len(zip_bytes)} bytes)")
    return output_path


def _album_to_pdf(minio_client, job_id, album_id, album_name, photos, quality, print_spec, bucket) -> str:
    """Generate a PDF album with one photo per page and upload to MinIO."""
    try:
        from fpdf import FPDF
    except ImportError:
        logger.warning("[album-export] fpdf2 not installed, falling back to ZIP")
        return _album_to_zip(minio_client, job_id, album_id, album_name, photos, quality, print_spec, bucket)

    import tempfile, math

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(0, 0, 0)

    # Cover page
    pdf.add_page()
    pdf.set_y(100)
    pdf.set_font("Helvetica", "B", 24)
    pdf.cell(0, 15, album_name[:50], align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 12)
    pdf.cell(0, 10, f"{len(photos)} photos", align="C", new_x="LMARGIN", new_y="NEXT")

    page_w, page_h = 210, 297  # A4 mm
    img_area_h = page_h - 20   # 10mm header + 10mm footer

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, p in enumerate(photos):
            try:
                jpg_bytes = _download_photo_for_export(
                    minio_client, p["minio_path"], quality, print_spec, bucket
                )
                tmp_path = os.path.join(tmpdir, f"p{idx}.jpg")
                with open(tmp_path, "wb") as f:
                    f.write(jpg_bytes)

                img = Image.open(BytesIO(jpg_bytes))
                iw, ih = img.size
                # Fit into page area maintaining aspect ratio
                scale = min(page_w / iw, img_area_h / ih)
                disp_w = iw * scale
                disp_h = ih * scale
                x = (page_w - disp_w) / 2
                y = 10  # top margin 10mm

                pdf.add_page()
                pdf.image(tmp_path, x=x, y=y, w=disp_w, h=disp_h)

                # Footer: filename + copyright
                pdf.set_font("Helvetica", "", 7)
                pdf.set_y(page_h - 10)
                footer = p.get("original_filename", "")
                if p.get("copyright"):
                    footer += f"  |  © {p['copyright']}"
                pdf.cell(page_w, 5, footer[:80], align="C")

            except Exception as e:
                logger.warning(f"[album-export:{job_id}] PDF: skipping photo {p.get('photo_id')}: {e}")

    pdf_bytes = bytes(pdf.output())
    output_path = f"export/album-{album_id}-{job_id}.pdf"
    minio_client.put_object(
        bucket, output_path, BytesIO(pdf_bytes), len(pdf_bytes),
        content_type="application/pdf"
    )
    logger.info(f"[album-export:{job_id}] PDF uploaded ({len(pdf_bytes)} bytes)")
    return output_path


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

        # 5b. Phase 15 — Minimalist frame rendering
        frame_style = opts.get("frame_style", "")
        if frame_style and frame_style not in ("none", "off", ""):
            try:
                frame_meta = _fetch_photo_meta(photo_id)
                img = _render_frame(img, frame_meta, opts)
                logger.info(f"[export:{job_id}] frame rendered: style={frame_style} ratio={opts.get('frame_ratio','original')}")
            except Exception as fe:
                logger.warning(f"[export:{job_id}] frame render failed (skipped): {fe}")

        # 6. Prepare output bytes
        out_buf = BytesIO()
        pil_fmt = {"jpeg": "JPEG", "jpg": "JPEG", "png": "PNG",
                   "webp": "WEBP", "tiff": "TIFF"}.get(fmt, "JPEG")
        save_kwargs: dict = {}

        if pil_fmt == "JPEG":
            save_kwargs["quality"]   = quality
            save_kwargs["subsampling"] = 0  # 4:4:4

            if embed_exif:
                # Phase 13: fetch IPTC copyright/creator from Go Core internal API
                iptc_copyright, iptc_creator, iptc_desc = b"", b"", b""
                try:
                    iptc_res = requests.get(
                        f"{GO_CORE_URL}/internal/photos/{photo_id}/iptc",
                        headers={"X-Internal-Secret": INTERNAL_SECRET},
                        timeout=5,
                    )
                    if iptc_res.ok:
                        iptc_json = iptc_res.json()
                        def _enc(s): return (s or "").encode("latin-1", errors="replace")
                        iptc_copyright = _enc(iptc_json.get("copyright", ""))
                        iptc_creator   = _enc(iptc_json.get("creator", ""))
                        iptc_desc      = _enc(iptc_json.get("description", ""))
                except Exception as ex:
                    logger.debug(f"[export:{job_id}] IPTC fetch skipped: {ex}")

                if orig_exif_bytes:
                    try:
                        exif_dict = piexif.load(orig_exif_bytes)
                    except Exception as ex:
                        logger.warning(f"[export:{job_id}] EXIF load failed: {ex}")
                        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}}
                else:
                    exif_dict = {"0th": {}, "Exif": {}, "GPS": {}}

                # Inject IPTC fields into IFD0
                if iptc_copyright:
                    exif_dict["0th"][piexif.ImageIFD.Copyright] = iptc_copyright
                if iptc_creator:
                    exif_dict["0th"][piexif.ImageIFD.Artist] = iptc_creator
                if iptc_desc:
                    exif_dict["0th"][piexif.ImageIFD.ImageDescription] = iptc_desc

                try:
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
                        album_id  = message_data.get("album_id")
                        task_type = message_data.get("type", "photo_export")
                        opts_json = message_data.get("export_options", "{}")

                        if job_id and task_type == "album_export" and album_id:
                            success = process_album_export(minio_client, job_id, album_id, opts_json)
                        elif job_id and photo_id:
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