from uuid import UUID
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_pos_orders_access
from database import get_db
from models.order import Order
from models.product import Product, ProductUnit
from models.customer import Customer
from models.sale_correction import SaleCorrection
from models.user import RoleEnum, User
from services.sale_correction_execution import apply_correction_settlement, preview_correction_settlement
from services.sale_correction_requests import (CorrectionProposal, create_correction_request,
                                                ensure_supported_request, reject_correction_request, request_correction_rereview,
                                                review_correction_request, withdraw_correction_request)
from services.sale_correction_pricing import CorrectionLines, resolve_correction_prices
from services.sale_correction_quote import quote_correction

router = APIRouter(prefix="/sale-corrections", tags=["Sale corrections"])


class CorrectionInput(BaseModel):
    order_id: UUID
    proposal: CorrectionProposal
    manual_review_confirmed: bool = False


class ReviewInput(BaseModel):
    manual_review_confirmed: bool = False


class RejectionInput(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class SettlementInput(BaseModel):
    confirmed: bool
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(403, "ليس لديك صلاحية تنفيذ هذا الإجراء.")
    if isinstance(exc, LookupError):
        return HTTPException(404, "الفاتورة أو الطلب غير موجود.")
    messages = {
        "The sale changed after the request; review a new proposal.": "تغيرت الفاتورة بعد الطلب؛ أنشئ طلب تعديل جديدًا.",
        "The sale changed after approval; create a new correction request.": "تغيرت الفاتورة بعد الموافقة؛ أنشئ طلب تعديل جديدًا.",
        "The proposed product prices or units changed; review a new proposal.": "تغير سعر أو وحدة صنف جديد؛ راجع طلبًا جديدًا.",
        "The proposed product prices, units, cost or tax changed; review a new proposal.": "تغير سعر أو وحدة أو تكلفة أو ضريبة صنف؛ راجع طلبًا جديدًا.",
        "The original line does not match this sale, product, unit and price level.": "سطر الصنف الأصلي لا يطابق الفاتورة أو الوحدة أو التسعيرة.",
        "The original unit changed or is unavailable; add a new line for extra quantity.": "تغيرت الوحدة الأصلية أو أصبحت غير متاحة؛ أضف سطرًا جديدًا للكمية الإضافية.",
        "The original bundle components need manual review.": "مكونات الباقة القديمة تحتاج مراجعة يدوية.",
        "The new product, unit or price is unavailable.": "الصنف الجديد أو وحدته أو تسعيرته غير متاحة.",
        "Sales with shipping or wallet fees need manual review.": "الفاتورة الأصلية تشمل شحنًا أو رسوم محفظة وتحتاج مراجعة يدوية.",
        "This payment method needs manual review.": "طريقة دفع الفاتورة الأصلية تحتاج مراجعة يدوية.",
        "A sale with a previous return needs manual review.": "الفاتورة عليها مرتجع سابق وتحتاج مراجعة يدوية.",
        "Deferred payment history needs manual reconciliation.": "المديونية أو الدفعات السابقة تحتاج تسوية يدوية.",
        "The original payment needs manual financial review.": "دفع الفاتورة الأصلية يحتاج مراجعة مالية يدوية.",
        "The original stock movements do not match the sale.": "حركات المخزون الأصلية لا تطابق الفاتورة وتحتاج مراجعة.",
        "The original stock movements need manual review.": "حركات المخزون الأصلية تحتاج مراجعة يدوية.",
        "The corrected base quantity has too many decimal places.": "الكمية بعد تحويل الوحدة تحتاج تقليل المنازل العشرية.",
        "The request does not need another review.": "حالة الفاتورة لم تتغير ولا تحتاج مراجعة إضافية.",
        "The original shift or returns changed; the manager must review again.": "تغيرت الوردية أو المرتجعات؛ يجب مراجعة المدير مجددًا.",
        "A manual review is required before approval.": "تحتاج الفاتورة مراجعة يدوية من المدير قبل الموافقة.",
        "Insufficient stock for the corrected sale.": "المخزون لا يكفي للأصناف في الفاتورة المصححة.",
        "Discount cannot exceed the order subtotal.": "الخصم لا يمكن أن يتجاوز إجمالي الأصناف.",
        "Discount percentage does not match the order subtotal.": "نسبة الخصم لا تطابق قيمة الخصم على الأصناف الحالية.",
        "The corrected total changed; review it again.": "تغير إجمالي الفاتورة المصححة؛ راجعه مرة أخرى.",
        "The corrected line price changed; review it again.": "تغير سعر صنف جديد؛ راجع التعديل مرة أخرى.",
        "Review and confirm the current settlement amounts first.": "راجع مبالغ التسوية الحالية وأكدها أولًا.",
        "Open a cash register shift before cash transactions.": "افتح ورديتك قبل تسوية المبلغ النقدي.",
        "Changing the customer needs manual financial review.": "تغيير العميل يحتاج مراجعة مالية يدوية.",
        "This correction payment method needs manual review.": "طريقة الدفع تحتاج مراجعة مالية يدوية.",
        "The original bundle or cost needs manual review.": "الباقة أو التكلفة الأصلية تحتاج مراجعة يدوية.",
        "A product is unavailable or a bundle needs manual review.": "أحد الأصناف غير متاح أو الباقة تحتاج مراجعة يدوية.",
        "An active correction already exists for this sale.": "يوجد طلب تعديل نشط لهذه الفاتورة.",
        "Resolve the cancellation before correcting this sale.": "راجع طلب الإلغاء قبل تعديل الفاتورة.",
    }
    return HTTPException(409, messages.get(str(exc), "تعذر تنفيذ التعديل؛ راجع بيانات الفاتورة والتسوية."))


def _present(row: SaleCorrection, number=None, *, is_owner=False):
    original_total = Decimal(str(row.original_snapshot["order"]["total_amount"]))
    returned = sum((Decimal(str(item["returned_value"])) for item in row.original_snapshot["returns"]
                    if item["order_id"] == str(row.order_id)), Decimal("0"))
    return {"id": str(row.id), "order_id": str(row.order_id), "public_number": number,
            "requested_by": str(row.requested_by), "status": row.status, "manual_review": row.manual_review,
            "rereview_requested": row.rereview_requested_signature is not None,
            "is_owner": is_owner, "created_at": row.created_at, "rejection_reason": row.rejection_reason,
            "original_total": str(original_total), "effective_original_total": str(original_total - returned),
            "has_prior_returns": returned != 0, "proposed_quote": row.proposed_quote,
            "priced_lines": row.priced_lines, "proposal": row.proposal,
            "corrected_order_id": str(row.corrected_order_id) if row.corrected_order_id else None}


@router.get("")
async def list_requests(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
                        db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    query = select(SaleCorrection, Order.public_number).join(Order, Order.id == SaleCorrection.order_id)
    if user.role != RoleEnum.ADMIN:
        query = query.where(SaleCorrection.requested_by == user.id)
    rows = (await db.execute(query.order_by(case((SaleCorrection.status == "PENDING", 0), else_=1),
        SaleCorrection.created_at.desc(), SaleCorrection.id.desc()).offset(offset).limit(limit))).all()
    product_ids = {UUID(line["product_id"]) for row, _ in rows for line in row.priced_lines}
    unit_ids = {UUID(line["unit_id"]) for row, _ in rows for line in row.priced_lines}
    requester_ids = {row.requested_by for row, _ in rows}
    customer_ids = {UUID(value) for row, _ in rows for value in
                    (row.original_snapshot["order"].get("customer_id"), row.proposal.get("customer_id")) if value}
    products = {str(p.id): p.name_ar for p in (await db.execute(select(Product).where(Product.id.in_(product_ids)))).scalars()}
    units = {str(u.id): u.unit_name for u in (await db.execute(select(ProductUnit).where(ProductUnit.id.in_(unit_ids)))).scalars()}
    requesters = {person.id: person.full_name or person.username or person.email or "مستخدم" for person in
                  (await db.execute(select(User).where(User.id.in_(requester_ids)))).scalars()}
    customers = {str(customer.id): customer.name for customer in
                 (await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))).scalars()}
    result = []
    for row, number in rows:
        item = _present(row, number, is_owner=row.requested_by == user.id)
        item["requester_name"] = requesters.get(row.requested_by, "مستخدم")
        old_customer = row.original_snapshot["order"].get("customer_id")
        new_customer = row.proposal.get("customer_id")
        item["customer_changed"] = old_customer != new_customer
        item["original_customer_name"] = customers.get(old_customer, "عميل نقدي" if not old_customer else "عميل غير متاح")
        item["corrected_customer_name"] = customers.get(new_customer, "عميل نقدي" if not new_customer else "عميل غير متاح")
        item["priced_lines"] = [{**line, "product_name": products.get(line["product_id"], "صنف غير متاح"),
                                  "unit_name": units.get(line["unit_id"], "وحدة غير متاحة")}
                                 for line in row.priced_lines]
        result.append(item)
    return result


@router.get("/customer-search")
async def search_customers(q: str = Query(min_length=2, max_length=120), limit: int = Query(20, ge=1, le=20),
                           db: AsyncSession = Depends(get_db), _user: User = Depends(require_pos_orders_access)):
    term = q.strip()
    if len(term) < 2:
        return []
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    rows = (await db.execute(select(Customer.id, Customer.name, Customer.phone, Customer.address, Customer.addresses)
        .where(Customer.is_active == True, Customer.is_deleted == False,
               or_(Customer.name.ilike(pattern, escape="\\"), Customer.phone.ilike(pattern, escape="\\")))
        .order_by(Customer.name, Customer.id).limit(limit))).all()
    return [{"id": str(id), "name": name, "phone": phone, "address": address, "addresses": addresses or []}
            for id, name, phone, address, addresses in rows]


@router.post("", status_code=201)
async def create_request(payload: CorrectionInput, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_pos_orders_access)):
    try:
        row = await create_correction_request(db, payload.order_id, payload.proposal, user)
        if user.role == RoleEnum.ADMIN and row.status == "PENDING" and (not row.manual_review or payload.manual_review_confirmed):
            row = await review_correction_request(db, row.id, user, manual_review_confirmed=payload.manual_review_confirmed)
        await db.commit()
        return _present(row, is_owner=True)
    except (ValueError, PermissionError, LookupError) as exc:
        await db.rollback()
        raise _error(exc) from exc
    except IntegrityError as exc:
        await db.rollback()
        message = str(exc.orig)
        if "uq_sale_correction_active_order" in message or "sale_corrections_pkey" in message:
            raise HTTPException(409, "يوجد طلب تعديل قائم أو معرّف الطلب مستخدم.") from exc
        raise


@router.post("/quote")
async def quote_request(payload: CorrectionInput, db: AsyncSession = Depends(get_db),
                        user: User = Depends(require_pos_orders_access)):
    order = (await db.execute(select(Order).where(Order.id == payload.order_id).with_for_update())).scalar_one_or_none()
    if order is None or (user.role != RoleEnum.ADMIN and order.user_id != user.id):
        raise HTTPException(404, "الفاتورة غير موجودة.")
    try:
        await ensure_supported_request(db, order, payload.proposal, user)
        lines = await resolve_correction_prices(db, order.id, CorrectionLines(items=payload.proposal.items))
        quote = quote_correction(payload.proposal, lines)
        return {"quote": quote.as_json(), "items": [{"unit_price": str(line.unit_price),
            "quantity": str(line.quantity), "original_item_id": str(line.original_item_id) if line.original_item_id else None}
            for line in lines]}
    except (ValueError, PermissionError, LookupError) as exc:
        raise _error(exc) from exc


@router.post("/{request_id}/approve")
async def approve_request(request_id: UUID, payload: ReviewInput, db: AsyncSession = Depends(get_db),
                          user: User = Depends(require_admin)):
    try:
        row = await review_correction_request(db, request_id, user, manual_review_confirmed=payload.manual_review_confirmed)
        await db.commit()
        return _present(row, is_owner=row.requested_by == user.id)
    except (ValueError, PermissionError, LookupError) as exc:
        await db.rollback()
        raise _error(exc) from exc


@router.post("/{request_id}/reject")
async def reject_request(request_id: UUID, payload: RejectionInput, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_admin)):
    try:
        row = await reject_correction_request(db, request_id, user, payload.reason)
        await db.commit()
        return _present(row, is_owner=row.requested_by == user.id)
    except (ValueError, PermissionError, LookupError) as exc:
        await db.rollback()
        raise _error(exc) from exc


@router.post("/{request_id}/withdraw")
async def withdraw_request(request_id: UUID, db: AsyncSession = Depends(get_db),
                           user: User = Depends(require_pos_orders_access)):
    try:
        row = await withdraw_correction_request(db, request_id, user)
        await db.commit()
        return _present(row, is_owner=True)
    except (ValueError, PermissionError, LookupError) as exc:
        await db.rollback()
        raise _error(exc) from exc


@router.post("/{request_id}/request-review")
async def request_review(request_id: UUID, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_pos_orders_access)):
    try:
        row = await request_correction_rereview(db, request_id, user)
        await db.commit()
        return _present(row, is_owner=True)
    except (ValueError, PermissionError, LookupError) as exc:
        await db.rollback()
        raise _error(exc) from exc


@router.get("/{request_id}/settlement-preview")
async def settlement_preview(request_id: UUID, db: AsyncSession = Depends(get_db),
                             user: User = Depends(require_pos_orders_access)):
    try:
        return await preview_correction_settlement(db, request_id, user)
    except (ValueError, PermissionError, LookupError) as exc:
        await db.rollback()
        raise _error(exc) from exc


@router.post("/{request_id}/settle")
async def settle_request(request_id: UUID, payload: SettlementInput, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_pos_orders_access)):
    try:
        row = await apply_correction_settlement(db, request_id, user, confirmed=payload.confirmed, fingerprint=payload.fingerprint)
        await db.commit()
        return _present(row, is_owner=True)
    except (ValueError, PermissionError, LookupError) as exc:
        await db.rollback()
        raise _error(exc) from exc
