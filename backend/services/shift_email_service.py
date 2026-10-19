"""Immutable cash-shift summary and explicit SMTP delivery state."""

from datetime import datetime, timezone
from decimal import Decimal
import smtplib
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.financial import CashAdjustment, CashShift, Payment
from models.shift_email import ShiftEmailReport
from models.user import User
from services.gmail_smtp import send_gmail_message


CAIRO = ZoneInfo("Africa/Cairo")


def money(value: Decimal) -> str:
    return f"{Decimal(str(value)):,.2f} ج.م"


def local_time(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(CAIRO).strftime("%Y-%m-%d %H:%M")


async def prepare_shift_email(db: AsyncSession, shift: CashShift, recipient: str) -> ShiftEmailReport:
    """Create one report in the same transaction that closes the shift."""
    user = (await db.execute(select(User).where(User.id == shift.user_id))).scalar_one()
    payment_rows = (await db.execute(select(Payment.kind, func.count(Payment.id), func.coalesce(func.sum(Payment.amount), 0))
                                     .where(Payment.shift_id == shift.id).group_by(Payment.kind))).all()
    payments = {kind: (count, Decimal(str(total))) for kind, count, total in payment_rows}
    adjustments = (await db.execute(select(CashAdjustment).where(CashAdjustment.shift_id == shift.id)
                                    .order_by(CashAdjustment.created_at, CashAdjustment.id))).scalars().all()
    adjustment_total = sum((Decimal(str(entry.amount)) for entry in adjustments), Decimal("0"))
    counted = Decimal(str(shift.closing_cash))
    expected = Decimal(str(shift.expected_cash))
    cashier = user.full_name or user.username or user.email or str(user.id)
    lines = [
        "ملخص وردية الصندوق", "",
        f"الموظف: {cashier}",
        f"رقم الوردية: {shift.id}",
        f"الفتح: {local_time(shift.opened_at)} بتوقيت القاهرة",
        f"الإغلاق: {local_time(shift.closed_at)} بتوقيت القاهرة", "",
        f"رصيد البداية: {money(shift.opening_cash)}",
        f"مبيعات نقدية: {money(payments.get('SALE', (0, Decimal('0')))[1])} ({payments.get('SALE', (0, 0))[0]} عملية)",
        f"تحصيلات نقدية: {money(payments.get('COLLECTION', (0, Decimal('0')))[1])} ({payments.get('COLLECTION', (0, 0))[0]} عملية)",
        f"مبالغ مرتجعات نقدية: {money(payments.get('REFUND', (0, Decimal('0')))[1])} ({payments.get('REFUND', (0, 0))[0]} عملية)",
        f"صافي الحركات اليدوية: {money(adjustment_total)} ({len(adjustments)} حركة)",
        f"الرصيد المتوقع: {money(expected)}",
        f"النقدية المعدودة: {money(counted)}",
        f"الفرق (المعدود - المتوقع): {money(counted - expected)}",
    ]
    if adjustments:
        lines += ["", "تفاصيل الحركات اليدوية:"]
        lines += [f"- {money(entry.amount)} · {entry.reason}" for entry in adjustments]
    report = ShiftEmailReport(
        shift_id=shift.id,
        recipient_email=recipient,
        subject=f"ملخص وردية الصندوق · {local_time(shift.closed_at)}",
        body="\n".join(lines),
        status="PENDING",
        attempts=0,
    )
    db.add(report)
    return report


async def deliver_shift_email(db: AsyncSession, shift_id: UUID) -> str:
    """Send at most one concurrent attempt; a failed attempt stays visible for admin retry."""
    report = (await db.execute(select(ShiftEmailReport).where(ShiftEmailReport.shift_id == shift_id)
                               .with_for_update())).scalar_one_or_none()
    if report is None:
        return "NOT_CONFIGURED"
    if report.status == "SENT":
        return "SENT"
    report.attempts += 1
    try:
        await send_gmail_message(report.recipient_email, report.subject, report.body)
    except (OSError, smtplib.SMTPException, ValueError):
        report.status = "FAILED"
    else:
        report.status = "SENT"
        report.sent_at = datetime.now(timezone.utc)
    await db.commit()
    return report.status
