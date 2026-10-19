from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from typing import Optional, Literal
from uuid import UUID
from datetime import datetime
import re
from models.user import RoleEnum

OperationalRole = Literal[RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER, RoleEnum.CASHIER_ORDERS]


class UserProfileResponse(BaseModel):
    id: UUID
    role: RoleEnum
    email: Optional[str] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSyncRequest(BaseModel):
    id: UUID  # From Supabase Auth
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=100)
    role: OperationalRole

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        return UserRegisterRequest.validate_full_name(value)


class UserRegisterRequest(BaseModel):
    """Register a new local user (Admin only in production)."""
    email: Optional[EmailStr] = None
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=12)
    role: OperationalRole

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        name = " ".join(value.split())
        if len(name) < 2 or not re.fullmatch(r"[\u0621-\u064A\u0671-\u06D3]+(?:[ -][\u0621-\u064A\u0671-\u06D3]+)*", name):
            raise ValueError("Enter the employee name in Arabic")
        return name

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes")
        return value


class UserUpdateRequest(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = Field(default=None, min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    role: Optional[OperationalRole] = None
    password: Optional[str] = Field(default=None, min_length=12)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: Optional[str]) -> Optional[str]:
        return value.strip().lower() if value is not None else None

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: Optional[str]) -> Optional[str]:
        return UserRegisterRequest.validate_full_name(value) if value is not None else None

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes")
        return value


class UserStatusRequest(BaseModel):
    is_active: bool


class TokenResponse(BaseModel):
    """JWT token returned after successful login."""
    access_token: str
    token_type: str = "bearer"
    user: UserProfileResponse
