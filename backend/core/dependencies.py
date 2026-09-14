from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from uuid import UUID
import jwt

from core.security import decode_access_token
from database import get_db
from models.user import User, RoleEnum

# This tells Swagger where to send login requests to get a token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Shared dependency: validate JWT and return the current active user.
    Used as: current_user: User = Depends(get_current_user)
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_exception
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise credentials_exception

    query = select(User).where(
        User.id == UUID(user_id),
        User.is_active == True,
        User.is_deleted == False,
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


async def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Dependency that requires the current user to have the 'ADMIN' role.
    """
    if current_user.role != RoleEnum.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def require_inventory_access(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role not in (RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inventory or Admin access required",
        )
    return current_user


async def require_pos_orders_access(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cashier or Admin access required",
        )
    return current_user


async def require_sales_reports_access(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role not in (RoleEnum.ADMIN, RoleEnum.SENIOR_SALES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Senior Sales or Admin access required",
        )
    return current_user


async def require_basic_staff_access(
    current_user: User = Depends(get_current_user),
) -> User:
    # Any authenticated user with a valid role in RoleEnum has basic staff access
    if current_user.role not in (
        RoleEnum.ADMIN,
        RoleEnum.CASHIER_ORDERS,
        RoleEnum.SENIOR_SALES,
        RoleEnum.INVENTORY_CONTROLLER,
        RoleEnum.SALES_ASSISTANT
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff access required",
        )
    return current_user
