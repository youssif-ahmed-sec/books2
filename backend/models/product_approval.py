import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from .user import Base


class ProductApproval(Base):
    __tablename__ = "product_approvals"
    __table_args__ = (
        Index("ix_product_approvals_status_created", "status", "created_at"),
        Index("uq_product_approvals_pending_product", "product_id", unique=True,
              postgresql_where=text("status = 'PENDING'")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    action = Column(String(16), nullable=False)
    status = Column(String(16), nullable=False, default="PENDING")
    product_name = Column(String, nullable=False)
    baseline_hash = Column(String(64), nullable=False)
    baseline = Column(JSONB, nullable=False)
    proposed = Column(JSONB, nullable=True)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
