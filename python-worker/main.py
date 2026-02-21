import os
import time
import logging
import json
import requests
import base64
from io import BytesIO
from PIL import Image, ImageCms
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
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {STREAM_NAME: ">", AI_STREAM_NAME: ">"}, count=1, block=5000)
            
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

        except Exception as e:
            logger.error(f"Error in worker loop: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()