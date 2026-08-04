import os
import uuid
import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from models.user import User
from core.dependencies import get_current_user
from pydantic import BaseModel

router = APIRouter(prefix="/upload", tags=["Upload"])

class UploadResponse(BaseModel):
    secure_url: str

@router.post("/image", response_model=UploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Securely uploads an image to Cloudinary and returns the URL.
    Only authorized users can upload images.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File provided is not an image.")

    try:
        # Read file contents
        contents = await file.read()
        
        # Upload using cloudinary python SDK
        public_id = f"inventory_{uuid.uuid4().hex[:8]}"
        
        upload_result = cloudinary.uploader.upload(
            contents,
            public_id=public_id,
            folder="bookstore-erp"
        )
        
        return UploadResponse(secure_url=upload_result.get("secure_url"))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image upload failed: {str(e)}")
