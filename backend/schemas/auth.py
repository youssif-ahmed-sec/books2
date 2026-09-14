from pydantic import BaseModel, ConfigDict, EmailStr
from typing import Optional
from uuid import UUID
from datetime import datetime
from models.user import RoleEnum


class UserProfileResponse(BaseModel):
    id: UUID
    role: RoleEnum
    email: Optional[str] = None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSyncRequest(BaseModel):
    id: UUID  # From Supabase Auth
    email: EmailStr
    role: RoleEnum = RoleEnum.SALES_ASSISTANT


class UserRegisterRequest(BaseModel):
    """Register a new local user (Admin only in production)."""
    email: EmailStr
    password: str
    role: RoleEnum = RoleEnum.SALES_ASSISTANT


class TokenResponse(BaseModel):
    """JWT token returned after successful login."""
    access_token: str
    token_type: str = "bearer"
    user: UserProfileResponse
