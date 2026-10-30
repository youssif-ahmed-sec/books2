"""Prepare correction requests without changing sales, stock or payments.

The caller must commit or roll back and map business errors to API responses.
Request approval and execution are intentionally not exposed here.
"""
from uuid import UUID
from datetime import datetime, timezone

from pydantic import ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.idempotency import request_fingerprint
from models.order import Order, OrderItem, OrderStatusEnum
from models.sale_cancellation import SaleCancellation
from models.sale_correction import SaleCorrection
from models.user import AuditLog, RoleEnum, User
from models.customer import Customer
from models.inventory import Warehouse
from models.product import Product
from schemas.order import OrderCreate
from services.sale_correction_pricing import CorrectionLine, CorrectionLines, resolve_correction_prices
from services.sale_correction_snapshot import capture_sale_snapshot
from services.sale_correction_quote import quote_correction
from services.order_service import OrderService
from services.notification_service import notify_roles, notify_user
from services.sale_review import requires_review, review_signature
from services.cancellation_settlement import prepare_simple_cancellation


class CorrectionProposal(OrderCreate):
    model_config = ConfigDict(extra="forbid")
    items: list[CorrectionLine]


def _priced_lines_json(lines):
    return [{"product_id": str(line.product_id), "unit_id": str(line.unit_id),
             "price_level": line.price_level, "quantity": str(line.quantity),
             "unit_price": str(line.unit_price), "conversion_factor": str(line.conversion_factor),
             "original_item_id": str(line.original_item_id) if line.original_item_id else None,
             "bundle_components_snapshot": line.bundle_components_snapshot,
             "tax_rate": str(line.tax_rate) if line.tax_rate is not None else None,
             "base_cost": str(line.base_cost) if line.base_cost is not None else None} for line in lines]


async def ensure_supported_request(db: AsyncSession, order: Order, proposal: CorrectionProposal, user: User):
    """Fail closed before accepting a proposal the current executor cannot settle."""
    if proposal.payment_method not in ("Cash", "Credit Card", "Instapay", "Wallet", "Deferred Payment"):
        raise ValueError("This correction payment method needs manual review.")
    old_quote = await prepare_simple_cancellation(db, order_id=order.id, request_id=proposal.request_id, actor_id=user.id,
                                                  allow_prior_returns=True)
    if old_quote.payload is None or old_quote.retained_fees or (old_quote.refund_amount and old_quote.refund_method is None):
        raise ValueError("The original payment needs manual financial review.")
    original_items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
    if not original_items or any(not isinstance(item.bundle_components_snapshot, list) or item.cost_at_sale is None for item in original_items):
        raise ValueError("The original bundle or cost needs manual review.")
    products = (await db.execute(select(Product).where(Product.id.in_({line.product_id for line in proposal.items})))).scalars().all()
    if len(products) != len({line.product_id for line in proposal.items}) or any(p.is_deleted or not p.is_active for p in products):
        raise ValueError("A product is unavailable or a bundle needs manual review.")


async def create_correction_request(db: AsyncSession, order_id: UUID, proposal: CorrectionProposal,
                                    user: User) -> SaleCorrection:
    if not user.is_active or user.is_deleted or user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        raise PermissionError("Active sales access is required.")
    fingerprint = request_fingerprint(proposal)
    prior = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == proposal.request_id))).scalar_one_or_none()

    def check_replay(row):
        if row.order_id != order_id or row.requested_by != user.id or row.proposal_fingerprint != fingerprint:
            raise ValueError("Correction request ID was already used differently.")
        return row

    if prior:
        return check_replay(prior)
    order = (await db.execute(select(Order).where(Order.id == order_id).with_for_update())).scalar_one_or_none()
    if order is None or (user.role != RoleEnum.ADMIN and order.user_id != user.id):
        raise LookupError("Sale not found.")
    prior = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == proposal.request_id))).scalar_one_or_none()
    if prior:
        return check_replay(prior)
    if order.status not in (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value,
                            OrderStatusEnum.RETURNED.value, OrderStatusEnum.EXCHANGE.value):
        raise ValueError("Only completed sales can be corrected.")
    if (await db.execute(select(SaleCorrection.id).where(
        SaleCorrection.order_id == order_id, SaleCorrection.status.in_(("PENDING", "AWAITING_SETTLEMENT")),
    ).limit(1))).first():
        raise ValueError("An active correction already exists for this sale.")
    if (await db.execute(select(SaleCancellation.id).where(
        SaleCancellation.order_id == order_id,
        SaleCancellation.status.in_(("PENDING", "AWAITING_SETTLEMENT", "APPROVED")),
    ).limit(1))).first():
        raise ValueError("Resolve the cancellation before correcting this sale.")
    await ensure_supported_request(db, order, proposal, user)
    snapshot, state_hash = await capture_sale_snapshot(db, order_id)
    lines = await resolve_correction_prices(db, order_id, CorrectionLines(items=proposal.items))
    priced_lines = _priced_lines_json(lines)
    quoted = quote_correction(proposal, lines).as_json()
    row = SaleCorrection(id=proposal.request_id, order_id=order_id, requested_by=user.id, status="PENDING",
                         manual_review=await requires_review(db, order),
                         original_snapshot=snapshot, original_fingerprint=state_hash,
                         proposal=proposal.model_dump(mode="json"), proposal_fingerprint=fingerprint,
                         priced_lines=priced_lines, proposed_quote=quoted)
    db.add(row)
    db.add(AuditLog(user_id=user.id, action="SALE_CORRECTION_REQUESTED", entity_type="Order",
                    entity_id=str(order_id), new_value={"request_id": str(row.id)}))
    if user.role != RoleEnum.ADMIN:
        await notify_roles(db, (RoleEnum.ADMIN,), kind="sale_correction_requested", title="طلب تعديل فاتورة",
                           message=f"طلب تعديل الفاتورة {order.public_number}.", href="/orders?corrections=1")
    await db.flush()
    return row


async def review_correction_request(db: AsyncSession, request_id: UUID, user: User,
                                    *, manual_review_confirmed: bool = False) -> SaleCorrection:
    """Record manager approval only if the sale evidence and proposed prices still match."""
    if not user.is_active or user.is_deleted or user.role != RoleEnum.ADMIN:
        raise PermissionError("Active admin access is required.")
    row = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise LookupError("Correction request not found.")
    if row.status not in ("PENDING", "AWAITING_SETTLEMENT"):
        raise ValueError("Correction request is no longer pending.")
    _, current_hash = await capture_sale_snapshot(db, row.order_id)
    if current_hash != row.original_fingerprint:
        raise ValueError("The sale changed after the request; review a new proposal.")
    order = (await db.execute(select(Order).where(Order.id == row.order_id).with_for_update())).scalar_one()
    signature = await review_signature(db, order)
    changed_review = row.status == "AWAITING_SETTLEMENT" and row.review_signature != signature
    if row.status == "AWAITING_SETTLEMENT" and not changed_review:
        raise ValueError("The request does not need another review.")
    needs_manual = row.manual_review or changed_review or await requires_review(db, order)
    if needs_manual and not manual_review_confirmed:
        raise ValueError("A manual review is required before approval.")
    proposal = CorrectionProposal.model_validate(row.proposal)
    lines = await resolve_correction_prices(db, row.order_id, CorrectionLines(items=proposal.items))
    if _priced_lines_json(lines) != row.priced_lines:
        raise ValueError("The proposed product prices or units changed; review a new proposal.")
    if quote_correction(proposal, lines).as_json() != row.proposed_quote:
        raise ValueError("The proposed financial amounts changed; review a new proposal.")
    warehouse = (await db.execute(select(Warehouse.id).where(Warehouse.id == proposal.warehouse_id, Warehouse.is_active == True))).scalar_one_or_none()
    if warehouse is None:
        raise ValueError("Choose an active warehouse for the sale.")
    await OrderService._check_pricing_policy(db, proposal.customer_id, proposal.items, proposal.discount_amount, user.id)
    if proposal.customer_address:
        customer = (await db.execute(select(Customer).where(Customer.id == proposal.customer_id))).scalar_one_or_none()
        if customer is None or proposal.customer_address.strip() not in [customer.address, *(customer.addresses or [])]:
            raise ValueError("Choose a saved address for this customer.")
    row.status = "AWAITING_SETTLEMENT"
    row.manual_review = needs_manual
    row.review_signature = signature
    row.rereview_requested_signature = None
    row.reviewed_by = user.id
    row.reviewed_at = datetime.now(timezone.utc)
    db.add(AuditLog(user_id=user.id, action="SALE_CORRECTION_APPROVED", entity_type="Order",
                    entity_id=str(row.order_id), new_value={"request_id": str(row.id)}))
    if row.requested_by != user.id:
        notify_user(db, row.requested_by, kind="sale_correction_approved", title="تمت الموافقة على طلب تعديل الفاتورة",
                    message="الطلب بانتظار تسوية الفروق.", href="/orders?corrections=1")
    await db.flush()
    return row


async def reject_correction_request(db: AsyncSession, request_id: UUID, user: User, reason: str) -> SaleCorrection:
    if not user.is_active or user.is_deleted or user.role != RoleEnum.ADMIN:
        raise PermissionError("Active admin access is required.")
    reason = reason.strip()
    if len(reason) < 3 or len(reason) > 500:
        raise ValueError("A rejection reason of 3 to 500 characters is required.")
    row = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise LookupError("Correction request not found.")
    if row.status != "PENDING":
        raise ValueError("Correction request is no longer pending.")
    row.status = "REJECTED"
    row.reviewed_by = user.id
    row.reviewed_at = datetime.now(timezone.utc)
    row.rejection_reason = reason
    db.add(AuditLog(user_id=user.id, action="SALE_CORRECTION_REJECTED", entity_type="Order",
                    entity_id=str(row.order_id), new_value={"request_id": str(row.id), "reason": reason}))
    if row.requested_by != user.id:
        notify_user(db, row.requested_by, kind="sale_correction_rejected", title="رُفض طلب تعديل الفاتورة",
                    message="راجع سبب الرفض في طلبات التعديل.", href="/orders?corrections=1")
    await db.flush()
    return row


async def withdraw_correction_request(db: AsyncSession, request_id: UUID, user: User) -> SaleCorrection:
    if not user.is_active or user.is_deleted or user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        raise PermissionError("Active sales access is required.")
    row = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None or row.requested_by != user.id:
        raise LookupError("Correction request not found.")
    if row.status not in ("PENDING", "AWAITING_SETTLEMENT"):
        raise ValueError("Correction request cannot be withdrawn.")
    row.status = "WITHDRAWN"
    db.add(AuditLog(user_id=user.id, action="SALE_CORRECTION_WITHDRAWN", entity_type="Order",
                    entity_id=str(row.order_id), new_value={"request_id": str(row.id)}))
    if row.reviewed_by and row.reviewed_by != user.id:
        notify_user(db, row.reviewed_by, kind="sale_correction_withdrawn", title="تم سحب طلب تعديل الفاتورة",
                    message="سحب صاحب الطلب التعديل قبل تسويته.", href="/orders?corrections=1")
    await db.flush()
    return row


async def request_correction_rereview(db: AsyncSession, request_id: UUID, user: User) -> SaleCorrection:
    if not user.is_active or user.is_deleted or user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        raise PermissionError("Active sales access is required.")
    row = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None or row.requested_by != user.id:
        raise LookupError("Correction request not found.")
    if row.status != "AWAITING_SETTLEMENT":
        raise ValueError("The correction has not been approved for settlement.")
    _, current_hash = await capture_sale_snapshot(db, row.order_id)
    if current_hash != row.original_fingerprint:
        raise ValueError("The sale changed after approval; create a new correction request.")
    order = (await db.execute(select(Order).where(Order.id == row.order_id).with_for_update())).scalar_one()
    signature = await review_signature(db, order)
    if signature == row.review_signature:
        raise ValueError("The request does not need another review.")
    if signature != row.rereview_requested_signature:
        row.rereview_requested_signature = signature
        db.add(AuditLog(user_id=user.id, action="SALE_CORRECTION_REREVIEW_REQUESTED", entity_type="Order",
                        entity_id=str(row.order_id), new_value={"request_id": str(row.id)}))
        await notify_roles(db, (RoleEnum.ADMIN,), kind="sale_correction_rereview_requested", title="طلب مراجعة تعديل فاتورة",
                           message=f"تغيرت حالة الفاتورة {order.public_number} بعد الموافقة؛ راجع الطلب مجددًا.", href="/orders?corrections=1")
        await db.flush()
    return row
