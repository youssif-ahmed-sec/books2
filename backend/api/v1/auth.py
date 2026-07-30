from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from uuid import UUID
import jwt
import os

from models.user import User
from schemas.auth import UserProfileResponse, UserSyncRequest
from database import get_db

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])

security = HTTPBearer()


def get_user_id_from_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UUID:
    """
    Decode Supabase JWT and extract user ID (sub claim).
    """
    token = credentials.credentials
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET")

    try:
        if jwt_secret:
            # Verify signature with the Supabase JWT secret
            payload = jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False}
            )
        else:
            # No secret configured — decode without verification (dev fallback)
            payload = jwt.decode(
                token,
                options={"verify_signature": False}
            )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing user ID"
            )
        return UUID(user_id)

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}"
        )


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
    user_id: UUID = Depends(get_user_id_from_token),
    db: AsyncSession = Depends(get_db)
):
    """
    Get the currently logged-in user's profile using their Supabase JWT.
    """
    query = select(User).where(User.id == user_id, User.is_deleted == False)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found. Please sync your account first via POST /auth/sync."
        )

    return user
