from fastapi import APIRouter, Depends, HTTPException, status, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from uuid import UUID

from models.user import User, RoleEnum
from schemas.auth import UserProfileResponse, UserSyncRequest, UserRegisterRequest, TokenResponse
from core.security import hash_password, verify_password, create_access_token
from core.dependencies import get_current_user, require_admin
from database import get_db

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])


class SimpleLoginForm:
    """Custom login form — shows only email (username) and password in Swagger."""
    def __init__(
        self,
        username: str = Form(..., description="Your email address"),
        password: str = Form(..., description="Your password"),
    ):
        self.username = username
        self.password = password


# ── Login ────────────────────────────────────────────────────────────────────

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="🔑 Login with Email & Password",
    description="Enter your **email** in the `username` field and your **password**. Returns a JWT Bearer token.",
)
async def login(
    form_data: SimpleLoginForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """
    OAuth2 compatible login — Swagger will show username + password fields.
    Use the returned `access_token` with the 🔒 Authorize button in Swagger.
    """
    clean_email = form_data.username.strip().lower()
    
    query = select(User).where(
        User.email == clean_email,
        User.is_deleted == False,
        User.is_active == True,
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value},
    )

    return TokenResponse(access_token=token, user=user)


# ── Register (Admin only in production) ─────────────────────────────────────

@router.post(
    "/register",
    response_model=UserProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="📝 Register a new local user (Admin only)",
)
async def register_user(
    user_data: UserRegisterRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Create a new user with email + password (hashed with bcrypt).
    In production, protect this endpoint with Admin role check.
    """
    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == user_data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    new_user = User(
        email=user_data.email,
        hashed_password=hash_password(user_data.password),
        role=user_data.role,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


# ── Get current user profile ─────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="👤 Get my profile",
)
async def get_current_user_profile(
    current_user: User = Depends(get_current_user),
):
    """
    Returns the currently authenticated user's profile.
    Requires a valid JWT Bearer token.
    """
    return current_user


# ── Sync Supabase user ────────────────────────────────────────────────────────

@router.post(
    "/sync",
    response_model=UserProfileResponse,
    summary="🔄 Sync Supabase user",
)
async def sync_user_profile(
    user_data: UserSyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Sync a Supabase authenticated user with our local User profile table.
    If the user doesn't exist, they are created.
    """
    query = select(User).where(User.id == user_data.id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            id=user_data.id,
            email=user_data.email,
            role=user_data.role,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return user
