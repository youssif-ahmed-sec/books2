"""Prepare and atomically apply supported prepaid sale corrections.

The caller owns the transaction and must commit a successful result. Unsupported
financial histories and bundle changes fail before customer settlement.
"""
from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.idempotency import request_fingerprint
from models.financial import Payment
from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum
from models.order import Order, OrderItem
from models.product import Product
from models.customer import Customer
from models.sale_correction import SaleCorrection
from models.user import AuditLog, RoleEnum, User
from services.cancellation_settlement import prepare_simple_cancellation
from services.cash_register_service import open_shift
from services.notification_service import notify_user
from services.order_service import OrderService
from services.return_service import ReturnService
from services.sale_correction_pricing import CorrectionLines, _component_signature, resolve_correction_prices
from services.sale_correction_quote import quote_correction
from services.sale_correction_requests import CorrectionProposal, _priced_lines_json
from services.sale_correction_settlement import PaymentDelta, payment_deltas
from services.sale_correction_snapshot import capture_sale_snapshot, snapshot_fingerprint
from services.sale_review import review_signature


@dataclass
class PreparedCorrection:
    row: SaleCorrection
    original: Order
    proposal: CorrectionProposal
    lines: list
    old_quote: object
    new_quote: object
    adjustments: list
    fingerprint: str
    customer_changed: bool
    original_customer_name: str
    corrected_customer_name: str

    def public_quote(self):
        return {"original_total": str(self.old_quote.refund_amount + self.old_quote.debt_amount), "corrected_total": str(self.new_quote.total),
                "old_debt": str(self.old_quote.debt_amount), "new_debt": str(self.new_quote.deferred_remaining),
                "adjustments": self.adjustments, "fingerprint": self.fingerprint,
                "customer_changed": self.customer_changed, "original_customer_name": self.original_customer_name,
                "corrected_customer_name": self.corrected_customer_name}


async def _prepare(db: AsyncSession, row: SaleCorrection, user: User) -> PreparedCorrection:
    if row.status != "AWAITING_SETTLEMENT":
        raise ValueError("The correction has not been approved for settlement.")
    _, current_hash = await capture_sale_snapshot(db, row.order_id)
    if current_hash != row.original_fingerprint:
        raise ValueError("The sale changed after approval; create a new correction request.")
    original = (await db.execute(select(Order).where(Order.id == row.order_id).with_for_update())).scalar_one()
    if row.review_signature != await review_signature(db, original):
        raise ValueError("The original shift or returns changed; the manager must review again.")
    reviewer = (await db.execute(select(User).where(User.id == row.reviewed_by))).scalar_one_or_none()
    if reviewer is None or reviewer.role != RoleEnum.ADMIN or not reviewer.is_active or reviewer.is_deleted:
        raise ValueError("An active manager must review the correction again.")
    proposal = CorrectionProposal.model_validate(row.proposal)
    customer_changed = proposal.customer_id != original.customer_id
    customer_ids = {customer_id for customer_id in (original.customer_id, proposal.customer_id) if customer_id is not None}
    customers = {customer.id: customer for customer in (await db.execute(select(Customer).where(
        Customer.id.in_(customer_ids),
    ).order_by(Customer.id).with_for_update().execution_options(populate_existing=True))).scalars().all()} if customer_ids else {}
    if (set(customers) != customer_ids or any(customer.is_deleted for customer in customers.values())
            or (proposal.customer_id is not None and not customers[proposal.customer_id].is_active)):
        raise ValueError("The original or corrected customer is unavailable.")
    if proposal.payment_method not in ("Cash", "Credit Card", "Instapay", "Wallet", "Deferred Payment"):
        raise ValueError("This correction payment method needs manual review.")
    lines = await resolve_correction_prices(db, row.order_id, CorrectionLines(items=proposal.items))
    if _priced_lines_json(lines) != row.priced_lines:
        raise ValueError("The proposed product prices, units, cost or tax changed; review a new proposal.")
    new_quote = quote_correction(proposal, lines)
    if new_quote.as_json() != row.proposed_quote:
        raise ValueError("The proposed financial amounts changed; review a new proposal.")
    old_quote = await prepare_simple_cancellation(db, order_id=original.id, request_id=row.id, actor_id=user.id,
                                                  allow_prior_returns=row.manual_review)
    if old_quote.payload is None or old_quote.retained_fees or (old_quote.refund_amount and old_quote.refund_method is None):
        raise ValueError("The original payment needs manual financial review.")
    if old_quote.debt_amount and original.customer_id is None:
        raise ValueError("The original payment needs manual financial review.")
    if new_quote.deferred_remaining:
        if proposal.customer_id is None:
            raise ValueError("A customer is required for deferred payment.")
        next_balance = Decimal(str(customers[proposal.customer_id].balance or 0)) + new_quote.deferred_remaining
        if proposal.customer_id == original.customer_id:
            next_balance -= old_quote.debt_amount
        if next_balance < 0 or next_balance > Decimal(str(customers[proposal.customer_id].credit_limit or 0)):
            raise ValueError("The corrected customer balance exceeds the credit limit.")

    original_items = (await db.execute(select(OrderItem).where(OrderItem.order_id == original.id))).scalars().all()
    if not original_items or any(not isinstance(item.bundle_components_snapshot, list) or item.cost_at_sale is None for item in original_items):
        raise ValueError("The original bundle or cost needs manual review.")
    for item in original_items:
        _component_signature(item.bundle_components_snapshot)
    parent_ids = {line.product_id for line in lines}
    component_ids = {UUID(part["product_id"]) for line in lines for part in (line.bundle_components_snapshot or [])}
    component_ids.update(UUID(part["product_id"]) for item in original_items for part in item.bundle_components_snapshot)
    locked = (await db.execute(select(Product).where(Product.id.in_(parent_ids | component_ids))
                               .order_by(Product.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
    products = {product.id: product for product in locked}
    if not (parent_ids | component_ids) <= products.keys() or any(products[id].is_deleted or not products[id].is_active for id in parent_ids):
        raise ValueError("A product is unavailable or a bundle needs manual review.")
    # Lock parent and component products before re-reading their prices and recipes.
    lines = await resolve_correction_prices(db, row.order_id, CorrectionLines(items=proposal.items))
    if _priced_lines_json(lines) != row.priced_lines:
        raise ValueError("The proposed product prices, units, cost or tax changed; review a new proposal.")
    sold = {}
    item_by_id = {item.id: item for item in original_items}
    for item in original_items:
        actual = Decimal(str(item.quantity_requested)) * Decimal(str(item.conversion_factor))
        if actual != Decimal(str(item.quantity_actual)):
            raise ValueError("The original stock quantities need manual review.")
        parts = item.bundle_components_snapshot or [{"product_id": str(item.product_id), "quantity": "1"}]
        for part in parts:
            component_id = UUID(part["product_id"])
            component_quantity = actual * Decimal(str(part["quantity"]))
            if component_quantity.quantize(Decimal("0.01")) != component_quantity:
                raise ValueError("The original stock quantities need manual review.")
            sold[component_id] = sold.get(component_id, Decimal("0")) + component_quantity
    movements = (await db.execute(select(InventoryTransaction).where(
        InventoryTransaction.reference_document == str(original.id),
        InventoryTransaction.transaction_type == TransactionTypeEnum.ISSUING,
    ))).scalars().all()
    issued = {}
    for movement in movements:
        if movement.warehouse_id != old_quote.payload.warehouse_id or Decimal(str(movement.quantity_changed)) >= 0:
            raise ValueError("The original stock movements need manual review.")
        issued[movement.product_id] = issued.get(movement.product_id, Decimal("0")) - Decimal(str(movement.quantity_changed))
    if issued != sold:
        raise ValueError("The original stock movements do not match the sale.")
    returned = {}
    for line in old_quote.payload.lines:
        item = item_by_id[line.order_item_id]
        actual = line.quantity * Decimal(str(item.conversion_factor))
        parts = item.bundle_components_snapshot or [{"product_id": str(item.product_id), "quantity": "1"}]
        for part in parts:
            component_id = UUID(part["product_id"])
            returned[component_id] = returned.get(component_id, Decimal("0")) + actual * Decimal(str(part["quantity"]))
    required = {}
    for line in lines:
        actual = line.quantity * line.conversion_factor
        if actual.quantize(Decimal("0.01")) != actual:
            raise ValueError("The corrected base quantity has too many decimal places.")
        parts = line.bundle_components_snapshot or [{"product_id": str(line.product_id), "quantity": "1"}]
        for part in parts:
            component_id = UUID(part["product_id"])
            component_quantity = actual * Decimal(str(part["quantity"]))
            if component_quantity.quantize(Decimal("0.01")) != component_quantity:
                raise ValueError("The corrected base quantity has too many decimal places.")
            required[component_id] = required.get(component_id, Decimal("0")) + component_quantity
    balances = (await db.execute(select(InventoryBalance).where(
        InventoryBalance.warehouse_id.in_({proposal.warehouse_id, old_quote.payload.warehouse_id}),
        InventoryBalance.product_id.in_(set(required) | set(returned)),
    ).order_by(InventoryBalance.product_id, InventoryBalance.warehouse_id).with_for_update())).scalars().all()
    available = {(balance.product_id, balance.warehouse_id): Decimal(str(balance.current_stock)) for balance in balances}
    if any((product_id, old_quote.payload.warehouse_id) not in available for product_id in returned):
        raise ValueError("The original stock movements need manual review.")
    for product_id, quantity in required.items():
        restored = returned.get(product_id, Decimal("0")) if proposal.warehouse_id == old_quote.payload.warehouse_id else Decimal("0")
        if available.get((product_id, proposal.warehouse_id), Decimal("0")) + restored < quantity:
            raise ValueError("Insufficient stock for the corrected sale.")
    new_method = proposal.received_method if proposal.payment_method == "Deferred Payment" else proposal.payment_method
    if new_quote.collected and not new_method:
        raise ValueError("Choose how the corrected payment is collected.")
    if customer_changed:
        deltas = []
        if old_quote.refund_amount:
            deltas.append(PaymentDelta(old_quote.refund_method, "REFUND", old_quote.refund_amount))
        if new_quote.collected:
            deltas.append(PaymentDelta(new_method, "SALE", new_quote.collected))
    else:
        previous = {old_quote.refund_method: old_quote.refund_amount} if old_quote.refund_amount else {}
        proposed = {new_method: new_quote.collected} if new_quote.collected else {}
        deltas = payment_deltas(previous, proposed)
    if any(delta.method == "Cash" for delta in deltas):
        await open_shift(db, user.id)
    adjustments = [{"kind": delta.kind, "method": delta.method, "amount": str(delta.amount)} for delta in deltas]
    original_name = customers[original.customer_id].name if original.customer_id else "عميل نقدي"
    corrected_name = customers[proposal.customer_id].name if proposal.customer_id else "عميل نقدي"
    fingerprint = snapshot_fingerprint({"request_id": str(row.id), "original": row.original_fingerprint,
                                        "proposal": row.proposal_fingerprint, "quote": new_quote.as_json(),
                                        "lines": row.priced_lines, "adjustments": adjustments,
                                        "customer_names": [original_name, corrected_name],
                                        "old_debt": str(old_quote.debt_amount), "new_debt": str(new_quote.deferred_remaining)})
    return PreparedCorrection(row, original, proposal, lines, old_quote, new_quote, adjustments, fingerprint,
                              customer_changed, original_name, corrected_name)


async def preview_correction_settlement(db: AsyncSession, request_id: UUID, user: User) -> dict:
    if not user.is_active or user.is_deleted or user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        raise PermissionError("Active sales access is required.")
    row = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == request_id).with_for_update())).scalar_one_or_none()
    if row is None or row.requested_by != user.id:
        raise LookupError("Correction request not found.")
    return (await _prepare(db, row, user)).public_quote()


async def apply_correction_settlement(db: AsyncSession, request_id: UUID, user: User,
                                      *, confirmed: bool, fingerprint: str) -> SaleCorrection:
    try:
        if not user.is_active or user.is_deleted or user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
            raise PermissionError("Active sales access is required.")
        row = (await db.execute(select(SaleCorrection).where(SaleCorrection.id == request_id).with_for_update())).scalar_one_or_none()
        if row is None or row.requested_by != user.id:
            raise LookupError("Correction request not found.")
        if row.status == "APPLIED":
            if not confirmed or row.settlement_fingerprint != fingerprint:
                raise ValueError("The correction was settled with a different confirmation.")
            return row
        prepared = await _prepare(db, row, user)
        if not confirmed or fingerprint != prepared.fingerprint:
            raise ValueError("Review and confirm the current settlement amounts first.")

        async def suppress_original_payment(_session, _order, result, difference):
            if difference != -(prepared.old_quote.refund_amount + prepared.old_quote.debt_amount):
                raise ValueError("The original settlement changed; review it again.")
            if prepared.old_quote.debt_amount:
                customer = (await _session.execute(select(Customer).where(Customer.id == _order.customer_id).with_for_update())).scalar_one()
                if Decimal(str(customer.balance)) < prepared.old_quote.debt_amount or Decimal(str(_order.deferred_remaining)) != prepared.old_quote.debt_amount:
                    raise ValueError("The original debt changed; review it again.")
                customer.balance = Decimal(str(customer.balance)) - prepared.old_quote.debt_amount
                _order.deferred_remaining = Decimal("0")
                _order.next_due_date = None
            result.refund_amount = Decimal("0")
            result.charge_amount = Decimal("0")

        returned = await ReturnService._process_once(db, prepared.old_quote.payload, user.id,
            request_fingerprint(prepared.old_quote.payload), commit=False, settlement_override=suppress_original_payment)
        corrected = await OrderService._create_order_once(db, prepared.proposal, user.id,
            request_fingerprint(prepared.proposal), commit=False, correction_lines=prepared.lines,
            original_order_id=prepared.original.id, pricing_user_id=row.reviewed_by, defer_payment=True)
        corrected_order = (await db.execute(select(Order).where(Order.id == corrected["id"]).with_for_update())).scalar_one()
        if Decimal(str(corrected_order.total_amount)) != prepared.new_quote.total:
            raise ValueError("The corrected total changed; review it again.")
        if prepared.new_quote.deferred_remaining:
            customer = (await db.execute(select(Customer).where(Customer.id == corrected_order.customer_id).with_for_update())).scalar_one()
            new_balance = Decimal(str(customer.balance or 0)) + prepared.new_quote.deferred_remaining
            if new_balance > Decimal(str(customer.credit_limit or 0)):
                raise ValueError("The corrected customer balance exceeds the credit limit.")
            customer.balance = new_balance
        returned.kind = "EXCHANGE"
        returned.exchange_order_id = corrected_order.id
        returned.replacement_value = prepared.new_quote.total
        returned.refund_amount = sum((Decimal(item["amount"]) for item in prepared.adjustments if item["kind"] == "REFUND"), Decimal("0"))
        returned.charge_amount = sum((Decimal(item["amount"]) for item in prepared.adjustments if item["kind"] == "SALE"), Decimal("0"))
        for adjustment in prepared.adjustments:
            shift_id = (await open_shift(db, user.id)).id if adjustment["method"] == "Cash" else None
            db.add(Payment(order_id=prepared.original.id if adjustment["kind"] == "REFUND" else corrected_order.id,
                           customer_id=prepared.original.customer_id if adjustment["kind"] == "REFUND" else corrected_order.customer_id,
                           user_id=user.id, shift_id=shift_id,
                           amount=Decimal(adjustment["amount"]), method=adjustment["method"], kind=adjustment["kind"],
                           correction_id=row.id))
        row.corrected_order_id = corrected_order.id
        row.settlement_fingerprint = fingerprint
        row.settlement_breakdown = prepared.adjustments
        row.settlement_debts = {"old_debt": str(prepared.old_quote.debt_amount), "new_debt": str(prepared.new_quote.deferred_remaining)}
        row.status = "APPLIED"
        db.add(AuditLog(user_id=user.id, action="SALE_CORRECTION_APPLIED", entity_type="Order",
                        entity_id=str(prepared.original.id), new_value={"request_id": str(row.id),
                            "corrected_order_id": str(corrected_order.id), "adjustments": prepared.adjustments,
                            "debts": row.settlement_debts}))
        await db.flush()
        for customer_id in sorted({value for value in (prepared.original.customer_id, corrected_order.customer_id) if value is not None}, key=str):
            await OrderService._record_customer_sale(db, customer_id, Decimal("0"))
        if row.reviewed_by != user.id:
            notify_user(db, row.reviewed_by, kind="sale_correction_applied", title="تم تعديل الفاتورة",
                        message="تمت تسوية التعديل وتسجيل الفاتورة المصححة.", href="/orders?corrections=1")
        await db.flush()
        return row
    except Exception:
        await db.rollback()
        raise
