"""Transaction-scoped cancellation settlement for supported payment histories.

The caller owns the transaction, authorization, request state and confirmation.
"""
from decimal import Decimal
from dataclasses import dataclass
from collections import Counter
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.idempotency import request_fingerprint
from models.customer import Customer
from models.financial import CashShift, Payment
from models.inventory import InventoryTransaction, TransactionTypeEnum
from models.order import CustomerDebtAllocation, Order, OrderItem, OrderStatusEnum
from models.returns import SalesReturn, SalesReturnLine
from models.sale_correction import SaleCorrection
from schemas.returns import SalesReturnCreate
from services.return_service import ReturnService
from services.cash_register_service import open_shift
from services.sale_correction_settlement import PaymentDelta, payment_deltas


@dataclass(frozen=True)
class CancellationQuote:
    payload: SalesReturnCreate | None
    refund_amount: Decimal
    debt_amount: Decimal
    refund_method: str | None
    retained_fees: Decimal


async def _verified_correction_parent(db: AsyncSession, order: Order) -> SaleCorrection | None:
    parents = (await db.execute(select(SaleCorrection).where(
        SaleCorrection.corrected_order_id == order.id, SaleCorrection.status == "APPLIED",
    ).limit(2))).scalars().all()
    if not parents:
        return None
    if len(parents) != 1:
        raise ValueError("The corrected invoice history needs manual reconciliation.")
    parent = parents[0]
    record = (await db.execute(select(SalesReturn).where(SalesReturn.id == parent.id))).scalar_one_or_none()
    try:
        old = parent.original_snapshot["order"]
        previous = sum((Decimal(str(entry["returned_value"])) for entry in parent.original_snapshot["returns"]
                        if entry["order_id"] == str(parent.order_id)), Decimal("0"))
        expected_old = Decimal(str(old["total_amount"])) - previous
        expected_new = Decimal(str(parent.proposed_quote["total"]))
        if (record is None or record.kind != "EXCHANGE" or record.order_id != parent.order_id
                or record.exchange_order_id != order.id or Decimal(str(record.returned_value)) != expected_old
                or Decimal(str(record.replacement_value)) != expected_new or Decimal(str(order.total_amount)) != expected_new
                or parent.proposal.get("payment_method") != order.payment_method
                or parent.proposal.get("customer_id") != (str(order.customer_id) if order.customer_id else None)
                or not parent.settlement_fingerprint or not isinstance(parent.settlement_breakdown, list)):
            raise ValueError
        if (Decimal(str(old.get("shipping_cost") or 0)) != 0
                or Decimal(str(old.get("wallet_fee_amount") or 0)) != 0 or expected_old <= 0):
            raise ValueError
        old_method = old["payment_method"]
        if old.get("customer_id") != (str(order.customer_id) if order.customer_id else None):
            expected_deltas = [PaymentDelta(old_method, "REFUND", expected_old)]
            if expected_new:
                expected_deltas.append(PaymentDelta(order.payment_method, "SALE", expected_new))
        else:
            expected_deltas = payment_deltas({old_method: expected_old}, {order.payment_method: expected_new})
        expected = []
        for entry in parent.settlement_breakdown:
            kind, method, amount = entry["kind"], entry["method"], Decimal(str(entry["amount"]))
            if kind not in ("REFUND", "SALE") or not amount.is_finite() or amount <= 0:
                raise ValueError
            target_order = parent.order_id if kind == "REFUND" else order.id
            customer = old.get("customer_id") if kind == "REFUND" else (str(order.customer_id) if order.customer_id else None)
            expected.append((kind, method, amount, str(target_order), customer))
        if Counter((entry[0], entry[1], entry[2]) for entry in expected) != Counter(
                (entry.kind, entry.method, entry.amount) for entry in expected_deltas):
            raise ValueError
        if (Decimal(str(record.refund_amount)) != sum((e[2] for e in expected if e[0] == "REFUND"), Decimal("0"))
                or Decimal(str(record.charge_amount)) != sum((e[2] for e in expected if e[0] == "SALE"), Decimal("0"))):
            raise ValueError
        actual_payments = (await db.execute(select(Payment).where(Payment.correction_id == parent.id))).scalars().all()
        actual = [(p.kind, p.method, Decimal(str(p.amount)), str(p.order_id), str(p.customer_id) if p.customer_id else None)
                  for p in actual_payments]
        if Counter(actual) != Counter(expected) or any(p.user_id != parent.requested_by for p in actual_payments):
            raise ValueError
        for payment in actual_payments:
            if payment.method == "Cash":
                shift = (await db.execute(select(CashShift).where(CashShift.id == payment.shift_id))).scalar_one_or_none()
                if shift is None or shift.user_id != parent.requested_by:
                    raise ValueError
            elif payment.shift_id is not None:
                raise ValueError
    except (KeyError, TypeError, ArithmeticError, ValueError) as exc:
        raise ValueError("The corrected invoice history needs manual reconciliation.") from exc
    return parent


async def prepare_simple_cancellation(
    db: AsyncSession, *, order_id: UUID, request_id: UUID, actor_id: UUID, allow_prior_returns: bool = False,
) -> CancellationQuote:
    """Validate and quote the supported case without persisting any changes."""
    order = (await db.execute(select(Order).where(Order.id == order_id).with_for_update())).scalar_one_or_none()
    allowed_statuses = (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value)
    if allow_prior_returns:
        allowed_statuses += (OrderStatusEnum.RETURNED.value,)
    if order is None or order.status not in allowed_statuses:
        raise ValueError("The sale is unavailable or needs manual review.")
    retained_fees = Decimal(str(order.shipping_cost or 0)) + Decimal(str(order.wallet_fee_amount or 0))
    if retained_fees < 0:
        raise ValueError("The sale fees need manual review.")
    if order.payment_method not in ("Cash", "Credit Card", "Instapay", "Wallet", "Vodafone Cash", "Bank Transfer", "Deferred Payment"):
        raise ValueError("This payment method needs manual review.")
    if order.payment_method == "Cash":
        await open_shift(db, actor_id)
    parent = await _verified_correction_parent(db, order)
    previous_returns = (await db.execute(select(SalesReturn).where(
        (SalesReturn.order_id == order.id) | (SalesReturn.exchange_order_id == order.id),
    ))).scalars().all()
    if parent is not None:
        previous_returns = [record for record in previous_returns if record.id != parent.id]
    if previous_returns and not allow_prior_returns:
        raise ValueError("A sale with a previous return needs manual review.")
    if any(r.order_id != order.id or r.kind != "REFUND" or r.exchange_order_id is not None
           or r.payment_method != order.payment_method or Decimal(str(r.charge_amount or 0)) != 0
           or Decimal(str(r.refund_amount or 0)) != Decimal(str(r.returned_value or 0))
           for r in previous_returns):
        raise ValueError("The previous return history needs manual reconciliation.")
    already_refunded = sum((Decimal(str(r.refund_amount or 0)) for r in previous_returns), Decimal("0"))
    payments = (await db.execute(select(Payment).where(Payment.order_id == order.id))).scalars().all()
    sales = [p for p in payments if p.kind == "SALE"]
    refunds = [p for p in payments if p.kind == "REFUND"]
    debt_amount = Decimal("0")
    refund_method = order.payment_method
    if order.payment_method == "Deferred Payment":
        if retained_fees:
            raise ValueError("Deferred sales with shipping or wallet fees need manual review.")
        customer = (await db.execute(select(Customer).where(Customer.id == order.customer_id).with_for_update())).scalar_one_or_none()
        other_dues = (await db.execute(select(Order.id).where(
            Order.customer_id == order.customer_id, Order.id != order.id,
            Order.payment_method == "Deferred Payment", Order.status.in_(("Delivered", "Closed", "Returned", "Exchange")),
            (Order.deferred_remaining.is_(None)) | (Order.deferred_remaining > 0),
        ).limit(1))).first()
        allocations = (await db.execute(select(CustomerDebtAllocation.id).where(
            CustomerDebtAllocation.order_id == order.id,
        ).limit(1))).first()
        if (previous_returns or allocations or customer is None or other_dues or order.deferred_remaining is None
                or Decimal(str(order.total_amount)) <= 0
                or Decimal(str(order.deferred_remaining)) <= 0
                or Decimal(str(order.deferred_remaining)) > Decimal(str(order.total_amount))
                or Decimal(str(customer.balance)) != Decimal(str(order.deferred_remaining))):
            raise ValueError("Deferred payment history needs manual reconciliation.")
        debt_amount = Decimal(str(order.deferred_remaining))
        paid = Decimal(str(order.total_amount)) - debt_amount
        if paid:
            if (len(payments) != 1 or len(sales) != 1 or sales[0].method not in ("Cash", "Credit Card", "Instapay")
                    or Decimal(str(sales[0].amount)) != paid or Decimal(str(sales[0].wallet_fee_amount or 0)) != 0):
                raise ValueError("Deferred payment history needs manual reconciliation.")
            refund_method = sales[0].method
            if refund_method == "Cash":
                await open_shift(db, actor_id)
        elif payments:
            raise ValueError("Deferred payment history needs manual reconciliation.")
        else:
            refund_method = None
    elif parent is not None:
        direct_refunds = [payment for payment in payments if payment.correction_id is None and payment.kind == "REFUND"]
        if (any(payment.correction_id != parent.id and payment not in direct_refunds for payment in payments)
                or any(payment.kind != "SALE" or payment.method != order.payment_method
                       for payment in payments if payment.correction_id == parent.id)
                or any(payment.method != order.payment_method for payment in direct_refunds)
                or sum((Decimal(str(payment.amount)) for payment in direct_refunds), Decimal("0")) != already_refunded):
            raise ValueError("The corrected invoice history needs manual reconciliation.")
    elif (len(sales) != 1 or sales[0].method != order.payment_method
          or Decimal(str(sales[0].amount)) != Decimal(str(order.total_amount))
          or len(sales) + len(refunds) != len(payments)
          or any(p.method != order.payment_method for p in refunds)
          or sum((Decimal(str(p.amount)) for p in refunds), Decimal("0")) != already_refunded):
        raise ValueError("The payment history needs manual review.")
    warehouses = (await db.execute(select(InventoryTransaction.warehouse_id).where(
        InventoryTransaction.reference_document == str(order.id),
        InventoryTransaction.transaction_type == TransactionTypeEnum.ISSUING,
    ).distinct())).scalars().all()
    if len(warehouses) != 1:
        raise ValueError("The original warehouse needs manual review.")
    items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
    if not items:
        raise ValueError("The sale has no returnable items.")
    returned = dict((await db.execute(select(SalesReturnLine.order_item_id, func.sum(SalesReturnLine.quantity))
        .join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id)
        .where(SalesReturn.order_id == order.id).group_by(SalesReturnLine.order_item_id))).all())
    lines = []
    for item in items:
        remaining = Decimal(str(item.quantity_requested)) - Decimal(str(returned.get(item.id, 0)))
        if remaining < 0:
            raise ValueError("The previous return history needs manual reconciliation.")
        if remaining > 0:
            lines.append({"order_item_id": item.id, "quantity": remaining})
    subtotal = sum((Decimal(str(item.total_price)) for item in items), Decimal("0"))
    discount = Decimal(str(order.discount_amount or 0))
    merchandise_total = subtotal - discount
    if discount < 0 or merchandise_total < 0 or merchandise_total + retained_fees != Decimal(str(order.total_amount)):
        raise ValueError("The sale fees need manual review.")
    remaining_amount = merchandise_total - already_refunded
    if remaining_amount < 0:
        raise ValueError("The previous return history needs manual reconciliation.")
    if not lines:
        if allow_prior_returns and previous_returns and remaining_amount == 0:
            return CancellationQuote(None, Decimal("0"), Decimal("0"), None, retained_fees)
        raise ValueError("The sale has no returnable items.")
    payload = SalesReturnCreate(
        request_id=request_id, order_id=order.id, warehouse_id=warehouses[0], kind="REFUND",
        lines=lines, settlement_confirmed=True, expected_refund_amount=remaining_amount, expected_charge_amount=0,
    )
    quote = await ReturnService.preview(db, payload, actor_id)
    if quote["refund_amount"] != remaining_amount:
        raise ValueError("The refund does not match the recorded payment; manual review is required.")
    refund_amount = remaining_amount - debt_amount
    return CancellationQuote(payload, refund_amount, debt_amount, refund_method if refund_amount else None, retained_fees)


async def settle_simple_cancellation(
    db: AsyncSession, *, order_id: UUID, request_id: UUID, actor_id: UUID,
    confirmed_refund: Decimal, confirmed_debt: Decimal = Decimal("0"), confirmed_method: str | None = None,
    allow_prior_returns: bool = False,
) -> SalesReturn | None:
    """Reverse a supported fee-free sale; never commit the caller's transaction."""
    quote = await prepare_simple_cancellation(db, order_id=order_id, request_id=request_id, actor_id=actor_id,
                                              allow_prior_returns=allow_prior_returns)
    if (quote.refund_amount != confirmed_refund or quote.debt_amount != confirmed_debt
            or quote.refund_method != confirmed_method):
        raise ValueError("The refund amount changed; review it again before confirmation.")
    if quote.payload is None:
        return None
    override = None
    if quote.debt_amount and quote.refund_amount:
        async def override(session, order, result, difference):
            if difference != -(quote.refund_amount + quote.debt_amount):
                raise ValueError("The refund amount changed; review it again before confirmation.")
            customer = (await session.execute(select(Customer).where(Customer.id == order.customer_id).with_for_update())).scalar_one()
            if Decimal(str(customer.balance)) != quote.debt_amount or Decimal(str(order.deferred_remaining)) != quote.debt_amount:
                raise ValueError("Deferred payment history needs manual reconciliation.")
            shift_id = (await open_shift(session, actor_id)).id if quote.refund_method == "Cash" else None
            customer.balance = Decimal("0")
            order.deferred_remaining = Decimal("0")
            order.next_due_date = None
            result.refund_amount = quote.refund_amount
            result.payment_method = quote.refund_method
            session.add(Payment(order_id=order.id, customer_id=order.customer_id, user_id=actor_id,
                                shift_id=shift_id, amount=quote.refund_amount, method=quote.refund_method, kind="REFUND"))
    return await ReturnService._process_once(db, quote.payload, actor_id, request_fingerprint(quote.payload),
                                              commit=False, settlement_override=override)
