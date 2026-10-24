"""Create one manager alert per missed due date and retry its email delivery."""

import asyncio
import logging
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert

from database import AsyncSessionLocal
from models.customer import Customer
from models.notification import Notification
from models.order import CustomerDueAlert, Order
from models.user import RoleEnum, User
from services.gmail_smtp import gmail_configured, send_gmail_message

logger = logging.getLogger(__name__)
SCAN_INTERVAL_SECONDS = 60 * 60


async def create_overdue_alerts() -> int:
    today = datetime.now(ZoneInfo("Africa/Cairo")).date()
    async with AsyncSessionLocal() as db:
        order_ids = (await db.execute(select(Order.id).where(
            Order.deferred_remaining > 0, Order.next_due_date < today,
        ))).scalars().all()
        admins = (await db.execute(select(User).where(
            User.role == RoleEnum.ADMIN, User.is_active == True, User.is_deleted == False,
        ))).scalars().all()
        created = 0
        for order_id in order_ids:
            order = (await db.execute(select(Order).where(Order.id == order_id).with_for_update())).scalar_one_or_none()
            if order is None or not order.deferred_remaining or not order.next_due_date or order.next_due_date >= today:
                continue
            customer = (await db.execute(select(Customer).where(
                Customer.id == order.customer_id, Customer.is_deleted == False,
            ))).scalar_one_or_none()
            if customer is None:
                continue
            for admin in admins:
                alert_id = uuid.uuid4()
                added = (await db.execute(insert(CustomerDueAlert).values(
                    id=alert_id, order_id=order.id, due_date=order.next_due_date, user_id=admin.id,
                ).on_conflict_do_nothing(constraint="uq_customer_due_alert_order_date_user")
                    .returning(CustomerDueAlert.id))).scalar_one_or_none()
                if added is None:
                    continue
                db.add(Notification(
                    user_id=admin.id, kind="customer_overdue", title="مديونية عميل متأخرة",
                    message=f"{customer.name} · فاتورة {order.public_number} · المتبقي {order.deferred_remaining} ج.م · الاستحقاق {order.next_due_date}",
                    href=f"/customers?customer_id={customer.id}",
                ))
                created += 1
        await db.commit()
        return created


async def send_pending_due_emails() -> int:
    if not gmail_configured():
        return 0
    sent = 0
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    today = datetime.now(ZoneInfo("Africa/Cairo")).date()
    async with AsyncSessionLocal() as db:
        pending_ids = (await db.execute(select(CustomerDueAlert.id).where(
            CustomerDueAlert.email_sent_at.is_(None),
            or_(CustomerDueAlert.email_last_attempt_at.is_(None), CustomerDueAlert.email_last_attempt_at < cutoff),
        ).order_by(CustomerDueAlert.created_at).limit(50))).scalars().all()
        for alert_id in pending_ids:
            alert = (await db.execute(select(CustomerDueAlert).where(
                CustomerDueAlert.id == alert_id, CustomerDueAlert.email_sent_at.is_(None),
            ).with_for_update(skip_locked=True))).scalar_one_or_none()
            if alert is None:
                continue
            order = (await db.execute(select(Order).where(Order.id == alert.order_id))).scalar_one_or_none()
            admin = (await db.execute(select(User).where(User.id == alert.user_id))).scalar_one_or_none()
            if order is None or order.next_due_date != alert.due_date or not order.deferred_remaining or order.next_due_date >= today or admin is None or admin.is_deleted or not admin.is_active or admin.role != RoleEnum.ADMIN:
                alert.email_sent_at = datetime.now(timezone.utc)
                alert.email_last_error = "Superseded before email delivery"
                await db.commit()
                continue
            if not admin.email:
                alert.email_last_attempt_at = datetime.now(timezone.utc)
                alert.email_last_error = "Manager email is not set"
                await db.commit()
                continue
            customer = (await db.execute(select(Customer).where(Customer.id == order.customer_id))).scalar_one_or_none()
            if customer is None or customer.is_deleted:
                alert.email_sent_at = datetime.now(timezone.utc)
                await db.commit()
                continue
            alert.email_last_attempt_at = datetime.now(timezone.utc)
            alert.email_attempts = (alert.email_attempts or 0) + 1
            try:
                await send_gmail_message(
                    admin.email, f"مديونية متأخرة · فاتورة {order.public_number}",
                    f"العميل: {customer.name}\nالهاتف: {customer.phone or '—'}\n"
                    f"الفاتورة: {order.public_number}\nالمتبقي: {order.deferred_remaining} ج.م\n"
                    f"تاريخ الاستحقاق: {alert.due_date}\nراجع قسم العملاء في النظام.",
                )
            except (OSError, smtplib.SMTPException, ValueError) as error:
                alert.email_last_error = str(error)[:500]
                logger.warning("Customer due alert email failed for alert %s: %s", alert.id, type(error).__name__)
            else:
                alert.email_sent_at = datetime.now(timezone.utc)
                alert.email_last_error = None
                sent += 1
            await db.commit()
    return sent


async def run_customer_due_alerts() -> None:
    while True:
        try:
            await create_overdue_alerts()
            await send_pending_due_emails()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Customer due alert scan failed; retrying in one hour")
        await asyncio.sleep(SCAN_INTERVAL_SECONDS)
