from fastapi import APIRouter, Depends, HTTPException, status, Form
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from models.user import User, RoleEnum, AuditLog
from schemas.auth import UserProfileResponse, UserSyncRequest, UserRegisterRequest, UserUpdateRequest, UserStatusRequest, TokenResponse
from core.security import hash_password, verify_password, create_access_token
from core.dependencies import get_current_user, require_admin
from database import get_db

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])


class SimpleLoginForm:
    """OAuth-compatible login form accepting an email or optional username."""
    def __init__(
        self,
        username: str = Form(..., description="Email address or username"),
        password: str = Form(..., description="Your password"),
    ):
        self.username = username
        self.password = password


# ── Login ────────────────────────────────────────────────────────────────────

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="🔑 Login with Email/Username & Password",
    description="Enter your **email or username** in the `username` field and your **password**. Returns a JWT Bearer token.",
)
async def login(
    form_data: SimpleLoginForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """
    OAuth2 compatible login — Swagger will show username + password fields.
    Use the returned `access_token` with the 🔒 Authorize button in Swagger.
    """
    identifier = form_data.username.strip().lower()
    
    query = select(User).where(
        or_(func.lower(User.email) == identifier, User.username == identifier),
        User.is_deleted == False,
        User.is_active == True,
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value},
    )

    db.add(AuditLog(user_id=user.id, action="LOGIN", entity_type="User", entity_id=str(user.id)))
    await db.commit()

    return TokenResponse(access_token=token, user=user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.add(AuditLog(user_id=current_user.id, action="LOGOUT", entity_type="User", entity_id=str(current_user.id)))
    await db.commit()


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
    Create a new local user. Admin authorization is enforced by dependency.
    """
    # Deleted accounts keep their identifiers reserved for audit integrity.
    existing = await db.execute(select(User).where(func.lower(User.email) == str(user_data.email).lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )
    if user_data.username:
        existing = await db.execute(select(User).where(User.username == user_data.username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="A user with this username already exists")

    new_user = User(
        email=str(user_data.email).lower(),
        username=user_data.username,
        hashed_password=hash_password(user_data.password),
        role=user_data.role,
    )
    db.add(new_user)
    try:
        await db.flush()
        db.add(AuditLog(user_id=_admin.id, action="USER_CREATE", entity_type="User", entity_id=str(new_user.id)))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email or username already exists")
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


# ── List all users (Admin only) ──────────────────────────────────────────────

@router.get(
    "/users",
    response_model=List[UserProfileResponse],
    summary="👥 List all users (Admin only)",
)
async def list_all_users(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Returns a list of all registered users.
    Requires Admin role.
    """
    query = select(User).where(User.is_deleted == False).order_by(User.created_at.desc(), User.id)
    result = await db.execute(query)
    return result.scalars().all()


async def _managed_user(db: AsyncSession, user_id: UUID) -> User:
    user = (await db.execute(select(User).where(User.id == user_id, User.is_deleted == False))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _protect_admin_access(db: AsyncSession, user: User) -> None:
    if user.role != RoleEnum.ADMIN or not user.is_active:
        return
    # Lock active admin rows in a stable order. Concurrent removals must not
    # both observe the other admin and leave the system without an operator.
    admins = (await db.execute(select(User).where(
        User.role == RoleEnum.ADMIN, User.is_active == True, User.is_deleted == False,
    ).order_by(User.id).with_for_update())).scalars().all()
    if len(admins) <= 1:
        raise HTTPException(status_code=409, detail="The last active admin cannot be removed or deactivated")


@router.patch("/users/{user_id}", response_model=UserProfileResponse)
async def update_user(
    user_id: UUID,
    changes: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = await _managed_user(db, user_id)
    supplied = changes.model_fields_set
    if "role" in supplied and changes.role is None:
        raise HTTPException(status_code=422, detail="Role cannot be empty")
    if "email" in supplied and changes.email is None:
        raise HTTPException(status_code=422, detail="Email cannot be empty")
    if user.id == admin.id and changes.role is not None and changes.role != RoleEnum.ADMIN:
        raise HTTPException(status_code=409, detail="You cannot remove your own admin access")
    if changes.role is not None and changes.role != RoleEnum.ADMIN:
        await _protect_admin_access(db, user)
    if "email" in supplied:
        existing_email = (await db.execute(select(User.id).where(
            func.lower(User.email) == str(changes.email).lower(), User.id != user_id,
        ))).scalar_one_or_none()
        if existing_email:
            raise HTTPException(status_code=409, detail="A user with this email already exists")
    old_value = {key: getattr(user, key).value if key == "role" else getattr(user, key) for key in ("email", "username", "role")}
    if "email" in supplied:
        user.email = str(changes.email).lower()
    if "username" in supplied:
        user.username = changes.username
    if "role" in supplied:
        user.role = changes.role
    if changes.password is not None:
        user.hashed_password = hash_password(changes.password)
    db.add(AuditLog(user_id=admin.id, action="USER_UPDATE", entity_type="User", entity_id=str(user.id), old_value=old_value, new_value={"email": user.email, "username": user.username, "role": user.role.value, "password_changed": changes.password is not None}))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email or username already exists")
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}/status", response_model=UserProfileResponse)
async def set_user_status(
    user_id: UUID,
    changes: UserStatusRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = await _managed_user(db, user_id)
    if user.id == admin.id and not changes.is_active:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account")
    if not changes.is_active:
        await _protect_admin_access(db, user)
    previous = user.is_active
    user.is_active = changes.is_active
    db.add(AuditLog(user_id=admin.id, action="USER_ACTIVATE" if changes.is_active else "USER_DEACTIVATE", entity_type="User", entity_id=str(user.id), old_value={"is_active": previous}, new_value={"is_active": user.is_active}))
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = await _managed_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=409, detail="You cannot delete your own account")
    await _protect_admin_access(db, user)
    user.is_deleted = True
    user.is_active = False
    db.add(AuditLog(user_id=admin.id, action="USER_DELETE", entity_type="User", entity_id=str(user.id)))
    await db.commit()


# ── Sync Supabase user ────────────────────────────────────────────────────────

@router.post(
    "/sync",
    response_model=UserProfileResponse,
    summary="🔄 Sync Supabase user",
)
async def sync_user_profile(
    user_data: UserSyncRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Sync a Supabase authenticated user with our local User profile table.
    If the user doesn't exist, they are created. Requires Admin role.
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
