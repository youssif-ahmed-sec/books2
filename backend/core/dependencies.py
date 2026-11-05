from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_, func, or_, update
from uuid import UUID
from datetime import datetime, timedelta, timezone
import jwt

from core.security import access_token_hash, decode_access_token
from database import get_db
from models.user import AuthSession, RevokedAccessToken, User, RoleEnum

# This tells Swagger where to send login requests to get a token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
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

    try:
        parsed_user_id = UUID(user_id)
    except (ValueError, TypeError, AttributeError):
        raise credentials_exception

    session_id = payload.get("sid")
    if session_id:
        try:
            session_id = UUID(session_id)
        except (ValueError, TypeError, AttributeError):
            raise credentials_exception
    else:
        revoked = (await db.execute(select(RevokedAccessToken.token_hash).where(
            RevokedAccessToken.token_hash == access_token_hash(token),
        ))).scalar_one_or_none()
        if revoked is not None:
            raise credentials_exception
    now = datetime.now(timezone.utc)
    query = select(User).where(
        User.id == parsed_user_id,
        User.is_active == True,
        User.is_deleted == False,
    )
    if session_id:
        query = query.join(AuthSession, AuthSession.user_id == User.id).where(
            AuthSession.id == session_id,
            or_(
                and_(User.role == RoleEnum.CASHIER_ORDERS, AuthSession.created_at > now - timedelta(hours=24)),
                and_(User.role != RoleEnum.CASHIER_ORDERS, AuthSession.last_activity_at > now - timedelta(hours=2)),
            ),
        )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    if user.role not in (RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER, RoleEnum.CASHIER_ORDERS):
        raise HTTPException(status_code=401, detail="Account role must be reassigned by an admin")
    if session_id:
        if payload.get("role") != user.role.value:
            raise credentials_exception
        if request and request.headers.get("X-User-Activity") == "1" and user.role != RoleEnum.CASHIER_ORDERS:
            result = await db.execute(update(AuthSession).where(
                AuthSession.id == session_id, AuthSession.user_id == user.id,
                AuthSession.last_activity_at > now - timedelta(hours=2),
            ).values(last_activity_at=func.greatest(AuthSession.last_activity_at, now)))
            if not result.rowcount:
                raise credentials_exception
            await db.commit()
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


async def require_financial_access(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role != RoleEnum.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for financial records",
        )
    return current_user


async def require_sales_reporting_access(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != RoleEnum.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sales reporting access required")
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


async def require_warehouse_access(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role not in (
        RoleEnum.ADMIN,
        RoleEnum.INVENTORY_CONTROLLER,
        RoleEnum.CASHIER_ORDERS,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Warehouse access required",
        )
    return current_user


async def require_basic_staff_access(
    current_user: User = Depends(get_current_user),
) -> User:
    # Only current operational roles have staff access.
    if current_user.role not in (
        RoleEnum.ADMIN,
        RoleEnum.CASHIER_ORDERS,
        RoleEnum.INVENTORY_CONTROLLER,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff access required",
        )
    return current_user
