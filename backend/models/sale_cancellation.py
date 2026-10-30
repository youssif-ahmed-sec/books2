import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from models.user import Base


class SaleCancellation(Base):
    __tablename__ = "sale_cancellations"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'AWAITING_SETTLEMENT', 'APPROVED', 'REJECTED')", name="ck_sale_cancellation_status"),
        Index("uq_sale_cancellation_active_order", "order_id", unique=True,
              postgresql_where=text("status IN ('PENDING', 'AWAITING_SETTLEMENT', 'APPROVED')"),
              sqlite_where=text("status IN ('PENDING', 'AWAITING_SETTLEMENT', 'APPROVED')")),
        Index("ix_sale_cancellation_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String(16), nullable=False)
    manual_review = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    reason = Column(String(500), nullable=True)
    rejection_reason = Column(String(500), nullable=True)
    settlement_amount = Column(Numeric(12, 2), nullable=True)
    settlement_debt = Column(Numeric(12, 2), nullable=True)
    settlement_method = Column(String(32), nullable=True)
    review_signature = Column(String(64), nullable=True)
    rereview_requested_signature = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
