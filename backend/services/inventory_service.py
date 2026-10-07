from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum


class InventoryService:
    @staticmethod
    def record_movement(
        db: AsyncSession,
        balance: InventoryBalance,
        quantity: Decimal,
        user_id: UUID,
        transaction_type: TransactionTypeEnum,
        *,
        supplier_id: UUID | None = None,
        unit_cost: Decimal | None = None,
        reference_document: str | None = None,
        notes: str | None = None,
        request_id: UUID | None = None,
        request_fingerprint: str | None = None,
    ) -> InventoryTransaction:
        delta = Decimal(str(quantity))
        if delta == 0:
            raise ValueError("Quantity change must not be zero")
        next_stock = Decimal(str(balance.current_stock or 0)) + delta
        if next_stock < 0:
            raise ValueError("Insufficient stock")
        balance.current_stock = next_stock
        movement = InventoryTransaction(
            product_id=balance.product_id,
            warehouse_id=balance.warehouse_id,
            user_id=user_id,
            transaction_type=transaction_type,
            quantity_changed=delta,
            supplier_id=supplier_id,
            unit_cost=unit_cost,
            reference_document=reference_document,
            notes=notes,
            request_id=request_id,
            request_fingerprint=request_fingerprint,
        )
        db.add(movement)
        return movement
