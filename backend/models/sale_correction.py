import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from models.user import Base


class SaleCorrection(Base):
    __tablename__ = "sale_corrections"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'AWAITING_SETTLEMENT', 'APPLIED', 'REJECTED', 'WITHDRAWN')", name="ck_sale_correction_status"),
        Index("uq_sale_correction_active_order", "order_id", unique=True,
              postgresql_where=text("status IN ('PENDING', 'AWAITING_SETTLEMENT')"),
              sqlite_where=text("status IN ('PENDING', 'AWAITING_SETTLEMENT')")),
        Index("ix_sale_correction_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String(24), nullable=False)
    manual_review = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    review_signature = Column(String(64), nullable=True)
    rereview_requested_signature = Column(String(64), nullable=True)
    original_snapshot = Column(JSONB, nullable=False)
    original_fingerprint = Column(String(64), nullable=False)
    proposal = Column(JSONB, nullable=False)
    proposal_fingerprint = Column(String(64), nullable=False)
    priced_lines = Column(JSONB, nullable=False)
    proposed_quote = Column(JSONB, nullable=False)
    corrected_order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=True)
    settlement_fingerprint = Column(String(64), nullable=True)
    settlement_breakdown = Column(JSONB, nullable=True)
    settlement_debts = Column(JSONB, nullable=True)
    rejection_reason = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
