from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Numeric, String, CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from .user import Base


class SalesReturn(Base):
    __tablename__ = "sales_returns"
    __table_args__ = (
        CheckConstraint("refund_amount >= 0 AND charge_amount >= 0", name="ck_return_amounts_nonnegative"),
        Index("ix_sales_returns_created_at", "created_at"),
        Index("ix_sales_returns_order_id", "order_id"),
        Index("ix_sales_returns_exchange_order_id", "exchange_order_id"),
        UniqueConstraint("public_number", name="uq_sales_returns_public_number"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    public_number = Column(BigInteger, server_default=text("nextval('orders_public_number_seq'::regclass)"), nullable=False)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    exchange_order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=True)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    kind = Column(String, nullable=False)
    payment_method = Column(String, nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    refund_amount = Column(Numeric(12, 2), nullable=False, default=0)
    charge_amount = Column(Numeric(12, 2), nullable=False, default=0)
    returned_value = Column(Numeric(12, 2), nullable=False, default=0)
    replacement_value = Column(Numeric(12, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    @property
    def wallet_fee_amount(self) -> Decimal:
        if self.payment_method != "Wallet":
            return Decimal("0.00")
        return (Decimal(str(self.charge_amount or 0)) / Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP,
        )

    @property
    def collection_amount(self) -> Decimal:
        return Decimal(str(self.charge_amount or 0)) + self.wallet_fee_amount


class SalesReturnLine(Base):
    __tablename__ = "sales_return_lines"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_return_line_quantity_positive"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    return_id = Column(UUID(as_uuid=True), ForeignKey("sales_returns.id"), nullable=False)
    order_item_id = Column(UUID(as_uuid=True), ForeignKey("order_items.id"), nullable=False)
    quantity = Column(Numeric(10, 2), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
