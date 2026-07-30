from pydantic import BaseModel, ConfigDict, EmailStr
from typing import Optional
from uuid import UUID
from datetime import datetime
from models.user import RoleEnum

class UserProfileResponse(BaseModel):
    id: UUID
    role: RoleEnum
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserSyncRequest(BaseModel):
    id: UUID # From Supabase Auth
    email: EmailStr
    role: RoleEnum = RoleEnum.CASHIER
