from datetime import datetime, timezone
import smtplib
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user, require_admin
from database import get_db
from models.notification import Notification
from models.user import User
from services.gmail_smtp import gmail_configured, send_gmail_message
from services.notification_retention import notification_cutoff

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def serialize(row: Notification) -> dict:
    return {
        "id": str(row.id), "kind": row.kind, "title": row.title,
        "message": row.message, "href": row.href,
        "created_at": row.created_at, "read_at": row.read_at,
    }


@router.get("")
async def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    before: datetime | None = None,
    before_id: UUID | None = None,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if (before is None) != (before_id is None):
        raise HTTPException(status_code=422, detail="Both before and before_id are required")
    cutoff = notification_cutoff()
    filters = [Notification.user_id == user.id, Notification.created_at >= cutoff]
    if before is not None and before_id is not None:
        filters.append(or_(Notification.created_at < before, and_(
            Notification.created_at == before, Notification.id < before_id,
        )))
    rows = (await db.execute(select(Notification).where(*filters)
                             .order_by(Notification.created_at.desc(), Notification.id.desc())
                             .limit(limit + 1))).scalars().all()
    unread = (await db.execute(select(func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read_at.is_(None),
        Notification.created_at >= cutoff,
    ))).scalar_one()
    return {"items": [serialize(row) for row in rows[:limit]],
            "unread_count": unread, "has_more": len(rows) > limit}


@router.get("/badge-counts")
async def get_badge_counts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from models.product_approval import ProductApproval
    from models.purchase_document import PurchaseDocument
    from models.user import RoleEnum

    counts = {
        "product_approvals": 0,
        "purchases": 0,
    }

    if user.role == RoleEnum.ADMIN:
        approvals_count = (await db.execute(
            select(func.count(ProductApproval.id)).where(ProductApproval.status == "PENDING")
        )).scalar_one()
        counts["product_approvals"] = int(approvals_count or 0)

        purchases_count = (await db.execute(
            select(func.count(PurchaseDocument.id)).where(PurchaseDocument.status == "REQUESTED")
        )).scalar_one()
        counts["purchases"] = int(purchases_count or 0)

    elif user.role == RoleEnum.INVENTORY_CONTROLLER:
        ready_purchases_count = (await db.execute(
            select(func.count(PurchaseDocument.id)).where(
                PurchaseDocument.requested_by == user.id,
                PurchaseDocument.status.in_(("APPROVED", "ORDERED", "PARTIALLY_RECEIVED"))
            )
        )).scalar_one()
        counts["purchases"] = int(ready_purchases_count or 0)

        approvals_count = (await db.execute(
            select(func.count(ProductApproval.id)).where(
                ProductApproval.requested_by == user.id,
                ProductApproval.status == "PENDING",
            )
        )).scalar_one()
        counts["product_approvals"] = int(approvals_count or 0)

    return counts


@router.get("/email/status")
async def gmail_status(user: User = Depends(require_admin)):
    return {"configured": gmail_configured()}


@router.post("/email/test")
async def send_gmail_test(user: User = Depends(require_admin)):
    if not gmail_configured():
        raise HTTPException(status_code=503, detail="Gmail SMTP is not configured")
    if not user.email:
        raise HTTPException(status_code=422, detail="Admin account has no email address")
    try:
        await send_gmail_message(user.email, "تجربة بريد النظام", "تم قبول رسالة الاختبار من نظام المكتبة.")
    except (OSError, smtplib.SMTPException):
        raise HTTPException(status_code=503, detail="Gmail SMTP could not accept the test message")
    return {"accepted": True}


@router.post("/read-all")
async def read_all_notifications(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    await db.execute(update(Notification).where(
        Notification.user_id == user.id, Notification.read_at.is_(None),
        Notification.created_at >= notification_cutoff(),
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
        Notification.created_at >= notification_cutoff(),
    ))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        await db.commit()
    return {"ok": True}
