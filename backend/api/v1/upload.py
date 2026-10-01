import logging
import uuid
import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from starlette.concurrency import run_in_threadpool
from models.user import User
from core.dependencies import require_inventory_access
from pydantic import BaseModel

router = APIRouter(prefix="/upload", tags=["Upload"])
logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def matches_image_type(content_type: str, contents: bytes) -> bool:
    if content_type == "image/jpeg":
        return contents.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return contents.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return contents.startswith(b"RIFF") and contents[8:12] == b"WEBP"
    return False

class UploadResponse(BaseModel):
    secure_url: str

@router.post("/image", response_model=UploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    current_user: User = Depends(require_inventory_access)
):
    """
    Securely uploads an image to Cloudinary and returns the URL.
    Only authorized users can upload images.
    """
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are allowed.")

    contents = await file.read(MAX_IMAGE_BYTES + 1)
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 5 MB limit.")
    if not contents:
        raise HTTPException(status_code=400, detail="Image is empty.")
    if not matches_image_type(file.content_type, contents):
        raise HTTPException(status_code=400, detail="Image content does not match its type.")

    try:
        # The SDK is synchronous; keep it off the event loop.
        public_id = f"inventory_{uuid.uuid4().hex[:8]}"

        upload_result = await run_in_threadpool(
            cloudinary.uploader.upload,
            contents,
            public_id=public_id,
            folder="bookstore-erp",
            resource_type="image",
        )
        secure_url = upload_result.get("secure_url")
        if not secure_url:
            raise RuntimeError("Cloudinary returned no secure URL")
        return UploadResponse(secure_url=secure_url)

    except Exception:
        logger.exception("Image upload failed")
        raise HTTPException(status_code=502, detail="Image upload failed")
