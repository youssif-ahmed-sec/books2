from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from uuid import UUID

from models.user import User
from schemas.auth import UserProfileResponse, UserSyncRequest
# from ...core.database import get_db

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])

from database import get_db

@router.post("/sync", response_model=UserProfileResponse)
async def sync_user_profile(
    user_data: UserSyncRequest,
    db: AsyncSession = Depends(get_db)
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
            role=user_data.role
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return user

@router.get("/me", response_model=UserProfileResponse)
async def get_current_user_profile(
    # current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get the currently logged-in user's profile and roles.
    """
    # Mocking for structure
    pass
