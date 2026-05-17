from PIL import Image
from pillow_heif import register_heif_opener
import exifread
from io import BytesIO

register_heif_opener()

with open("/root/picture/A6704325.HIF", "rb") as f:
    data = f.read()

img = Image.open(BytesIO(data))
print("Pillow info keys:", img.info.keys())
if "exif" in img.info:
    print("Has EXIF in info")
    # We can pass the raw exif bytes to exifread?
    # No, exifread expects a file-like object of the whole image, or maybe we can parse the exif bytes.
    
