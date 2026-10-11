import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from .user import Base


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_purchase_order_quantity_positive"),
        CheckConstraint("received_quantity >= 0 AND received_quantity <= quantity", name="ck_purchase_order_received_range"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False)
    quantity = Column(Numeric(18, 2), nullable=False)
    received_quantity = Column(Numeric(18, 2), nullable=False, default=0)
    status = Column(String, nullable=False, default="REQUESTED")
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    ordered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
