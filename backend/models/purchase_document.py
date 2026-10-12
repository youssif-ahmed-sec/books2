import uuid

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .user import Base


class PurchaseDocument(Base):
    __tablename__ = "purchase_documents"
    __table_args__ = (
        CheckConstraint("status IN ('REQUESTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED')", name="ck_purchase_documents_status"),
        UniqueConstraint("request_id", name="uq_purchase_documents_request_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False)
    supplier_name = Column(String(200), nullable=False)
    status = Column(String(24), nullable=False, default="REQUESTED")
    note = Column(String(500), nullable=True)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    ordered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    lines = relationship("PurchaseDocumentLine", back_populates="document", order_by="PurchaseDocumentLine.created_at")
    receipts = relationship("PurchaseReceipt", back_populates="document", order_by="PurchaseReceipt.created_at")


class PurchaseDocumentLine(Base):
    __tablename__ = "purchase_document_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0 AND conversion_factor > 0 AND base_quantity > 0", name="ck_purchase_document_lines_positive"),
        CheckConstraint("received_base_quantity >= 0 AND received_base_quantity <= base_quantity", name="ck_purchase_document_lines_received"),
        UniqueConstraint("document_id", "product_id", "unit_id", name="uq_purchase_document_product_unit"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("purchase_documents.id"), nullable=False)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    unit_id = Column(UUID(as_uuid=True), ForeignKey("product_units.id"), nullable=False)
    product_name = Column(String(200), nullable=False)
    unit_name = Column(String(100), nullable=False)
    base_unit_name = Column(String(100), nullable=False)
    quantity = Column(Numeric(18, 2), nullable=False)
    conversion_factor = Column(Numeric(18, 2), nullable=False)
    base_quantity = Column(Numeric(18, 2), nullable=False)
    received_base_quantity = Column(Numeric(18, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    document = relationship("PurchaseDocument", back_populates="lines")


class PurchaseReceipt(Base):
    __tablename__ = "purchase_receipts"
    __table_args__ = (UniqueConstraint("request_id", name="uq_purchase_receipts_request_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("purchase_documents.id"), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    received_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    document = relationship("PurchaseDocument", back_populates="receipts")
    lines = relationship("PurchaseReceiptLine", back_populates="receipt")


class PurchaseReceiptLine(Base):
    __tablename__ = "purchase_receipt_lines"
    __table_args__ = (
        CheckConstraint("base_quantity > 0", name="ck_purchase_receipt_lines_positive"),
        UniqueConstraint("receipt_id", "document_line_id", name="uq_purchase_receipt_document_line"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_id = Column(UUID(as_uuid=True), ForeignKey("purchase_receipts.id"), nullable=False)
    document_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_document_lines.id"), nullable=False)
    base_quantity = Column(Numeric(18, 2), nullable=False)
    receipt = relationship("PurchaseReceipt", back_populates="lines")
