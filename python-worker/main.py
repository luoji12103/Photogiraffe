import os
import time
import logging
import json
import requests
from io import BytesIO
from PIL import Image
import redis
from minio import Minio
from pillow_heif import register_heif_opener

register_heif_opener()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "redispass")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "admin12345")
GO_CORE_URL = os.getenv("GO_CORE_URL", "http://go-core:8080")

STREAM_NAME = "image_processing_queue"
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

        # 2. Process image with Pillow
        logger.info(f"Processing image {photo_id}...")
        img = Image.open(BytesIO(img_data))
        
        # Convert to RGB if necessary (e.g., RGBA or CMYK)
        if img.mode != "RGB":
            img = img.convert("RGB")

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
        res = requests.put(update_url, json={"status": "completed"})
        res.raise_for_status()

        logger.info(f"Successfully processed photo {photo_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to process image {photo_id}: {e}")
        # Try to update status to failed
        try:
            update_url = f"{GO_CORE_URL}/internal/photos/{photo_id}/status"
            requests.put(update_url, json={"status": "failed"})
        except Exception as inner_e:
            logger.error(f"Failed to update status to failed: {inner_e}")
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
            # Read from Redis Stream
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {STREAM_NAME: ">"}, count=1, block=5000)
            
            if not messages:
                continue

            for stream, message_list in messages:
                for message_id, message_data in message_list:
                    logger.info(f"Received task: {message_id} -> {message_data}")
                    
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

        except Exception as e:
            logger.error(f"Error in worker loop: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()