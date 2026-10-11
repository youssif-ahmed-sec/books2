from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from .user import Base


class SalesReturn(Base):
    __tablename__ = "sales_returns"
    __table_args__ = (
        CheckConstraint("refund_amount >= 0 AND charge_amount >= 0", name="ck_return_amounts_nonnegative"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
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


class SalesReturnLine(Base):
    __tablename__ = "sales_return_lines"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_return_line_quantity_positive"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    return_id = Column(UUID(as_uuid=True), ForeignKey("sales_returns.id"), nullable=False)
    order_item_id = Column(UUID(as_uuid=True), ForeignKey("order_items.id"), nullable=False)
    quantity = Column(Numeric(10, 2), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
