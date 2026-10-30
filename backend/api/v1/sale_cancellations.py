from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_pos_orders_access
from database import get_db
from models.order import Order, OrderStatusEnum
from models.sale_cancellation import SaleCancellation
from models.sale_correction import SaleCorrection
from models.user import AuditLog, RoleEnum, User
from services.notification_service import notify_roles, notify_user
from services.cancellation_settlement import prepare_simple_cancellation, settle_simple_cancellation
from services.sale_review import requires_review, review_signature

router = APIRouter(prefix="/sale-cancellations", tags=["Sale cancellations"])


def settlement_error(exc: ValueError) -> str:
    messages = {
        "The sale is unavailable or needs manual review.": "الفاتورة غير متاحة أو تحتاج مراجعة يدوية.",
        "Sales with shipping or wallet fees need manual review.": "الفواتير التي تشمل شحنًا أو رسوم محفظة تحتاج مراجعة يدوية.",
        "Deferred sales with shipping or wallet fees need manual review.": "الفواتير الآجلة التي تشمل شحنًا أو رسوم محفظة تحتاج مراجعة يدوية.",
        "The sale fees need manual review.": "رسوم الفاتورة لا تطابق قيمتها وتحتاج مراجعة يدوية.",
        "This payment method needs manual review.": "طريقة الدفع تحتاج مراجعة يدوية.",
        "A sale with a previous return needs manual review.": "الفاتورة عليها مرتجع سابق وتحتاج مراجعة يدوية.",
        "The previous return history needs manual reconciliation.": "حركة المرتجعات السابقة تحتاج تسوية يدوية.",
        "The corrected invoice history needs manual reconciliation.": "حركات الفاتورة المصححة لا تتطابق وتحتاج مراجعة يدوية.",
        "The payment history needs manual review.": "حركات الدفع تحتاج مراجعة يدوية.",
        "Deferred payment history needs manual reconciliation.": "المديونية أو الدفعات السابقة تحتاج تسوية يدوية.",
        "The original warehouse needs manual review.": "المخزن الأصلي يحتاج مراجعة يدوية.",
        "The sale has no returnable items.": "لا توجد أصناف قابلة للإرجاع في الفاتورة.",
        "The refund does not match the recorded payment; manual review is required.": "مبلغ الرد لا يطابق الدفعة المسجلة ويحتاج مراجعة يدوية.",
        "The refund amount changed; review it again before confirmation.": "تغير مبلغ الرد؛ راجعه قبل التأكيد مرة أخرى.",
        "Open a cash register shift before cash transactions.": "افتح ورديتك قبل رد المبلغ النقدي.",
        "Legacy bundle needs component review before return.": "تحتاج مكونات الباقة القديمة للمراجعة قبل الإرجاع.",
        "Active return warehouse not found.": "المخزن الأصلي غير متاح للإرجاع.",
    }
    return messages.get(str(exc), "تعذرت التسوية؛ راجع تفاصيل الفاتورة وحالة الصندوق قبل رد المبلغ.")


class CancellationInput(BaseModel):
    request_id: UUID
    order_id: UUID
    reason: str | None = Field(default=None, max_length=500)
    confirmed_refund: Decimal | None = Field(default=None, ge=0, allow_inf_nan=False, max_digits=12, decimal_places=2)
    confirmed_debt: Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False, max_digits=12, decimal_places=2)
    confirmed_method: str | None = Field(default=None, max_length=32)
    refund_confirmed: bool = False


class RejectionInput(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class ApprovalInput(BaseModel):
    manual_review_confirmed: bool = False


class SettlementInput(BaseModel):
    confirmed_refund: Decimal = Field(ge=0, allow_inf_nan=False, max_digits=12, decimal_places=2)
    confirmed_debt: Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False, max_digits=12, decimal_places=2)
    confirmed_method: str | None = Field(default=None, max_length=32)
    refund_confirmed: bool


def present(row: SaleCancellation, number=None, total=None, method=None):
    return {"id": str(row.id), "order_id": str(row.order_id), "public_number": number,
            "requested_by": str(row.requested_by), "status": row.status,
            "manual_review": row.manual_review, "reason": row.reason,
            "rereview_requested": row.rereview_requested_signature is not None,
            "rejection_reason": row.rejection_reason, "created_at": row.created_at,
            "total_amount": str(total) if total is not None else None, "payment_method": method}


@router.get("")
async def list_requests(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
                        db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    query = select(SaleCancellation, Order.public_number, Order.total_amount, Order.payment_method).join(Order, Order.id == SaleCancellation.order_id)
    if user.role != RoleEnum.ADMIN:
        query = query.where(SaleCancellation.requested_by == user.id)
    rows = (await db.execute(query.order_by(case((SaleCancellation.status == "PENDING", 0), else_=1),
                                            SaleCancellation.created_at.desc(), SaleCancellation.id.desc())
                             .offset(offset).limit(limit))).all()
    return [{**present(row, number, total, method), "is_owner": row.requested_by == user.id}
            for row, number, total, method in rows]


@router.get("/direct-preview/{order_id}")
async def direct_preview(order_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order is None:
        raise HTTPException(404, "الفاتورة غير موجودة.")
    if await requires_review(db, order):
        return {"manual_review": True, "refund_amount": None, "payment_method": order.payment_method}
    try:
        quote = await prepare_simple_cancellation(db, order_id=order_id, request_id=uuid4(), actor_id=user.id)
    except ValueError as exc:
        raise HTTPException(409, settlement_error(exc)) from exc
    if quote.payload is None:
        raise HTTPException(409, "تحتاج الفاتورة مراجعة يدوية.")
    return {"manual_review": False, "refund_amount": str(quote.refund_amount), "debt_amount": str(quote.debt_amount), "retained_fees": str(quote.retained_fees),
            "payment_method": quote.refund_method,
            "settlement_type": "MIXED" if quote.debt_amount and quote.refund_amount else "DEBT" if quote.debt_amount else "REFUND"}


@router.post("", status_code=201)
async def create_request(payload: CancellationInput, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_pos_orders_access)):
    prior = (await db.execute(select(SaleCancellation).where(SaleCancellation.id == payload.request_id))).scalar_one_or_none()
    reason = (payload.reason or "").strip() or None

    async def replay(row):
        if row.requested_by != user.id or row.order_id != payload.order_id or row.reason != reason:
            raise HTTPException(409, "معرّف الطلب مستخدم لبيانات أخرى.")
        if user.role == RoleEnum.ADMIN and row.status == "APPROVED":
            if (not payload.refund_confirmed or row.settlement_amount is None or payload.confirmed_refund != row.settlement_amount
                    or payload.confirmed_debt != row.settlement_debt or payload.confirmed_method != row.settlement_method):
                raise HTTPException(409, "معرّف الطلب مستخدم لتسوية مختلفة.")
        return present(row)

    if prior:
        return await replay(prior)
    order = (await db.execute(select(Order).where(Order.id == payload.order_id).with_for_update())).scalar_one_or_none()
    if order is None or (user.role != RoleEnum.ADMIN and order.user_id != user.id):
        raise HTTPException(404, "الفاتورة غير موجودة.")
    prior = (await db.execute(select(SaleCancellation).where(SaleCancellation.id == payload.request_id))).scalar_one_or_none()
    if prior:
        return await replay(prior)
    if order.status not in (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value,
                            OrderStatusEnum.RETURNED.value, OrderStatusEnum.EXCHANGE.value):
        raise HTTPException(409, "الفاتورة غير مكتملة.")
    active = (await db.execute(select(SaleCancellation.id).where(
        SaleCancellation.order_id == order.id, SaleCancellation.status.in_(("PENDING", "AWAITING_SETTLEMENT", "APPROVED")),
    ).limit(1))).first()
    if active:
        raise HTTPException(409, "يوجد طلب إلغاء قائم أو معتمد لهذه الفاتورة.")
    active_correction = (await db.execute(select(SaleCorrection.id).where(
        SaleCorrection.order_id == order.id, SaleCorrection.status.in_(("PENDING", "AWAITING_SETTLEMENT")),
    ).limit(1))).first()
    if active_correction:
        raise HTTPException(409, "يوجد طلب تعديل نشط لهذه الفاتورة؛ راجعه قبل الإلغاء.")
    review = await requires_review(db, order)
    auto_approve = user.role == RoleEnum.ADMIN and not review
    if auto_approve and (not payload.refund_confirmed or payload.confirmed_refund is None):
        raise HTTPException(422, "راجع المبلغ وأكد التسوية قبل إتمام الإلغاء.")
    row = SaleCancellation(id=payload.request_id, order_id=order.id, requested_by=user.id,
        reviewed_by=user.id if auto_approve else None, reviewed_at=datetime.now(timezone.utc) if auto_approve else None,
        status="APPROVED" if auto_approve else "PENDING", manual_review=review, reason=reason)
    db.add(row)
    db.add(AuditLog(user_id=user.id, action="SALE_CANCELLATION_REQUEST", entity_type="Order",
                    entity_id=str(order.id), new_value={"status": row.status, "manual_review": review}))
    try:
        if auto_approve:
            await settle_simple_cancellation(db, order_id=order.id, request_id=row.id,
                                             actor_id=user.id, confirmed_refund=payload.confirmed_refund,
                                             confirmed_debt=payload.confirmed_debt, confirmed_method=payload.confirmed_method)
            row.settlement_amount = payload.confirmed_refund
            row.settlement_debt = payload.confirmed_debt
            row.settlement_method = payload.confirmed_method
        else:
            await notify_roles(db, (RoleEnum.ADMIN,), kind="sale_cancellation_requested", title="طلب إلغاء بيعة",
                               message=f"طلب إلغاء الفاتورة {order.public_number}.", href="/orders?cancellations=1")
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(409, settlement_error(exc)) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "يوجد طلب إلغاء قائم أو معتمد لهذه الفاتورة.") from exc
    return present(row, order.public_number)


@router.post("/{request_id}/approve")
async def approve_request(request_id: UUID, payload: ApprovalInput,
                          db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    row = (await db.execute(select(SaleCancellation).where(SaleCancellation.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "الطلب غير موجود.")
    if row.status == "AWAITING_SETTLEMENT":
        order = (await db.execute(select(Order).where(Order.id == row.order_id).with_for_update())).scalar_one()
        signature = await review_signature(db, order)
        if row.review_signature == signature:
            raise HTTPException(409, "الطلب لا يحتاج مراجعة إضافية.")
        if not payload.manual_review_confirmed:
            raise HTTPException(409, "تحتاج الفاتورة إلى مراجعة يدوية بسبب مرتجع سابق أو وردية مقفولة أو غير معروفة.")
        row.manual_review = True
        row.review_signature = signature
        row.rereview_requested_signature = None
        row.reviewed_by = user.id
        row.reviewed_at = datetime.now(timezone.utc)
        db.add(AuditLog(user_id=user.id, action="SALE_CANCELLATION_REVIEWED_AGAIN", entity_type="Order",
                        entity_id=str(order.id), new_value={"request_id": str(row.id)}))
        notify_user(db, row.requested_by, kind="sale_cancellation_reviewed", title="تمت مراجعة طلب الإلغاء",
                    message=f"راجع المدير طلب الفاتورة {order.public_number} مجددًا؛ تحقق من التسوية.", href="/orders?cancellations=1")
        await db.commit()
        return present(row, order.public_number)
    if row.status != "PENDING":
        raise HTTPException(409, "تم اتخاذ قرار لهذا الطلب.")
    order = (await db.execute(select(Order).where(Order.id == row.order_id).with_for_update())).scalar_one()
    review = row.manual_review or await requires_review(db, order)
    if review and not payload.manual_review_confirmed:
        raise HTTPException(409, "تحتاج الفاتورة إلى مراجعة يدوية بسبب مرتجع سابق أو وردية مقفولة أو غير معروفة.")
    row.manual_review = review
    row.review_signature = await review_signature(db, order)
    row.rereview_requested_signature = None
    row.status = "AWAITING_SETTLEMENT"
    row.reviewed_by = user.id
    row.reviewed_at = datetime.now(timezone.utc)
    db.add(AuditLog(user_id=user.id, action="SALE_CANCELLATION_APPROVED", entity_type="Order",
                    entity_id=str(order.id), new_value={"request_id": str(row.id), "manual_review": review}))
    if row.requested_by != user.id:
        notify_user(db, row.requested_by, kind="sale_cancellation_approved", title="تمت الموافقة على طلب الإلغاء",
                    message=f"وافق المدير على طلب الفاتورة {order.public_number}؛ أكّد التسوية لإتمام الإلغاء.", href="/orders?cancellations=1")
    await db.commit()
    return present(row, order.public_number)


@router.post("/{request_id}/request-review")
async def request_review(request_id: UUID, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_pos_orders_access)):
    row = (await db.execute(select(SaleCancellation).where(SaleCancellation.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None or row.requested_by != user.id:
        raise HTTPException(404, "الطلب غير موجود.")
    if row.status != "AWAITING_SETTLEMENT":
        raise HTTPException(409, "الطلب لم يعتمد للتسوية.")
    order = (await db.execute(select(Order).where(Order.id == row.order_id).with_for_update())).scalar_one()
    signature = await review_signature(db, order)
    if signature == row.review_signature:
        raise HTTPException(409, "الطلب لا يحتاج مراجعة إضافية.")
    if signature != row.rereview_requested_signature:
        row.rereview_requested_signature = signature
        db.add(AuditLog(user_id=user.id, action="SALE_CANCELLATION_REREVIEW_REQUESTED", entity_type="Order",
                        entity_id=str(order.id), new_value={"request_id": str(row.id)}))
        await notify_roles(db, (RoleEnum.ADMIN,), kind="sale_cancellation_rereview_requested", title="طلب مراجعة إلغاء بيعة",
                           message=f"تغيرت حالة الفاتورة {order.public_number} بعد الموافقة؛ راجع طلب الإلغاء مجددًا.", href="/orders?cancellations=1")
    await db.commit()
    return present(row, order.public_number)


@router.get("/{request_id}/settlement-preview")
async def settlement_preview(request_id: UUID, db: AsyncSession = Depends(get_db),
                             user: User = Depends(require_pos_orders_access)):
    row = (await db.execute(select(SaleCancellation).where(SaleCancellation.id == request_id))).scalar_one_or_none()
    if row is None or row.requested_by != user.id:
        raise HTTPException(404, "الطلب غير موجود.")
    if row.status != "AWAITING_SETTLEMENT":
        raise HTTPException(409, "الطلب لم يعتمد للتسوية.")
    order = (await db.execute(select(Order).where(Order.id == row.order_id))).scalar_one()
    if row.review_signature != await review_signature(db, order):
        raise HTTPException(409, "تحتاج الفاتورة مراجعة يدوية جديدة من المدير قبل رد المبلغ.")
    try:
        quote = await prepare_simple_cancellation(db, order_id=row.order_id, request_id=row.id, actor_id=user.id,
                                                  allow_prior_returns=row.manual_review)
    except ValueError as exc:
        raise HTTPException(409, settlement_error(exc)) from exc
    return {"refund_amount": str(quote.refund_amount), "debt_amount": str(quote.debt_amount), "retained_fees": str(quote.retained_fees),
            "payment_method": quote.refund_method, "already_returned": quote.payload is None,
            "settlement_type": "MIXED" if quote.debt_amount and quote.refund_amount else "DEBT" if quote.debt_amount else "REFUND"}


@router.post("/{request_id}/settle")
async def settle_request(request_id: UUID, payload: SettlementInput,
                         db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    row = (await db.execute(select(SaleCancellation).where(SaleCancellation.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None or row.requested_by != user.id:
        raise HTTPException(404, "الطلب غير موجود.")
    if row.status == "APPROVED":
        if (not payload.refund_confirmed or row.settlement_amount != payload.confirmed_refund
                or row.settlement_debt != payload.confirmed_debt or row.settlement_method != payload.confirmed_method):
            raise HTTPException(409, "تمت التسوية بمبلغ مختلف.")
        return present(row)
    if row.status != "AWAITING_SETTLEMENT":
        raise HTTPException(409, "الطلب لم يعتمد للتسوية.")
    order = (await db.execute(select(Order).where(Order.id == row.order_id).with_for_update())).scalar_one()
    if row.review_signature != await review_signature(db, order):
        raise HTTPException(409, "تحتاج الفاتورة مراجعة يدوية جديدة من المدير قبل رد المبلغ.")
    if not payload.refund_confirmed:
        raise HTTPException(422, "أكد التسوية قبل إتمام الإلغاء.")
    try:
        await settle_simple_cancellation(db, order_id=row.order_id, request_id=row.id,
                                         actor_id=user.id, confirmed_refund=payload.confirmed_refund,
                                         confirmed_debt=payload.confirmed_debt, confirmed_method=payload.confirmed_method,
                                         allow_prior_returns=row.manual_review)
        row.status = "APPROVED"
        row.settlement_amount = payload.confirmed_refund
        row.settlement_debt = payload.confirmed_debt
        row.settlement_method = payload.confirmed_method
        db.add(AuditLog(user_id=user.id, action="SALE_CANCELLATION_SETTLED", entity_type="Order",
                        entity_id=str(row.order_id), new_value={"request_id": str(row.id),
                                                               "settlement_amount": str(payload.confirmed_refund),
                                                               "debt_amount": str(payload.confirmed_debt), "method": payload.confirmed_method}))
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(409, settlement_error(exc)) from exc
    return present(row)


@router.post("/{request_id}/reject")
async def reject_request(request_id: UUID, payload: RejectionInput,
                         db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    row = (await db.execute(select(SaleCancellation).where(SaleCancellation.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "الطلب غير موجود.")
    if row.status != "PENDING":
        raise HTTPException(409, "تم اتخاذ قرار لهذا الطلب.")
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "اكتب سبب الرفض.")
    row.status = "REJECTED"
    row.reviewed_by = user.id
    row.reviewed_at = datetime.now(timezone.utc)
    row.rejection_reason = reason
    db.add(AuditLog(user_id=user.id, action="SALE_CANCELLATION_REJECTED", entity_type="Order",
                    entity_id=str(row.order_id), new_value={"request_id": str(row.id), "reason": reason}))
    if row.requested_by != user.id:
        notify_user(db, row.requested_by, kind="sale_cancellation_rejected", title="رُفض طلب إلغاء البيعة",
                    message="راجع سبب الرفض في طلبات الإلغاء.", href="/orders?cancellations=1")
    await db.commit()
    return present(row)
