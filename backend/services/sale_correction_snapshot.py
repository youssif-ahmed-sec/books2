"""Capture the original financial and inventory evidence for a sale correction.

The caller owns authorization, persistence and transaction boundaries. The order
row is locked while reading so sale, return and debt services that take the same
lock cannot change the captured order during the read.
"""
import hashlib
import json
import math
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from uuid import UUID

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.financial import Payment
from models.inventory import InventoryTransaction
from models.order import CustomerDebtAllocation, Order, OrderItem
from models.returns import SalesReturn, SalesReturnLine


def _serialize(value):
    if isinstance(value, Enum):
        return value.value
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Cannot snapshot non-finite money or quantity.")
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat() if value.tzinfo else value.isoformat()
    if isinstance(value, (UUID, date)):
        return str(value)
    if isinstance(value, (tuple, list)):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _serialize(item) for key, item in value.items()}
    raise TypeError(f"Unsupported snapshot value: {type(value).__name__}")


def _columns(row):
    return {column.key: _serialize(getattr(row, column.key)) for column in inspect(type(row)).column_attrs}


def snapshot_fingerprint(snapshot: dict) -> str:
    canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def capture_sale_snapshot(db: AsyncSession, order_id: UUID) -> tuple[dict, str]:
    await db.flush()
    order = (await db.execute(select(Order).where(Order.id == order_id).with_for_update()
                              .execution_options(populate_existing=True))).scalar_one_or_none()
    if order is None:
        raise ValueError("Sale not found.")
    items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order_id).order_by(OrderItem.id)
                              .execution_options(populate_existing=True))).scalars().all()
    returns = (await db.execute(select(SalesReturn).where(
        (SalesReturn.order_id == order_id) | (SalesReturn.exchange_order_id == order_id),
    ).order_by(SalesReturn.id).execution_options(populate_existing=True))).scalars().all()
    return_ids = [row.id for row in returns]
    lines = (await db.execute(select(SalesReturnLine).where(SalesReturnLine.return_id.in_(return_ids))
                              .order_by(SalesReturnLine.id).execution_options(populate_existing=True))).scalars().all() if return_ids else []
    allocations = (await db.execute(select(CustomerDebtAllocation).where(CustomerDebtAllocation.order_id == order_id)
                                    .order_by(CustomerDebtAllocation.id).execution_options(populate_existing=True))).scalars().all()
    allocated_payment_ids = [row.payment_id for row in allocations]
    payments = (await db.execute(select(Payment).where(
        (Payment.order_id == order_id) | Payment.id.in_(allocated_payment_ids),
    ).order_by(Payment.id).execution_options(populate_existing=True))).scalars().all()
    references = [str(order_id), *(str(return_id) for return_id in return_ids)]
    movements = (await db.execute(select(InventoryTransaction).where(InventoryTransaction.reference_document.in_(references))
                                  .order_by(InventoryTransaction.id).execution_options(populate_existing=True))).scalars().all()
    snapshot = {"version": 1, "order": _columns(order), "items": [_columns(row) for row in items],
                "payments": [_columns(row) for row in payments], "debt_allocations": [_columns(row) for row in allocations],
                "returns": [_columns(row) for row in returns], "return_lines": [_columns(row) for row in lines],
                "inventory_movements": [_columns(row) for row in movements]}
    return snapshot, snapshot_fingerprint(snapshot)
