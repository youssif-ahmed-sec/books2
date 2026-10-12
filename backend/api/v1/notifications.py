from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from database import get_db
from models.notification import Notification
from models.user import User

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def serialize(row: Notification) -> dict:
    return {
        "id": str(row.id), "kind": row.kind, "title": row.title,
        "message": row.message, "href": row.href,
        "created_at": row.created_at, "read_at": row.read_at,
    }


@router.get("")
async def list_notifications(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    rows = (await db.execute(select(Notification).where(
        Notification.user_id == user.id,
    ).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(30))).scalars().all()
    unread = (await db.execute(select(func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read_at.is_(None),
    ))).scalar_one()
    return {"items": [serialize(row) for row in rows], "unread_count": unread}


@router.post("/read-all")
async def read_all_notifications(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    await db.execute(update(Notification).where(
        Notification.user_id == user.id, Notification.read_at.is_(None),
    ).values(read_at=datetime.now(timezone.utc)))
    await db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
async def read_notification(
    notification_id: UUID, db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (await db.execute(select(Notification).where(
        Notification.id == notification_id, Notification.user_id == user.id,
    ))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        await db.commit()
    return {"ok": True}
