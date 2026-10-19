from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, Numeric, JSON, UniqueConstraint, Index, BigInteger, Sequence
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .user import Base
import enum
import uuid


class OrderStatusEnum(str, enum.Enum):
    """Order labels; transition rules are enforced by the service when defined."""
    NEW_LEAD = "New Lead"
    DRAFT = "Draft Order"
    WAITING_QUOTATION = "Waiting Quotation"
    QUOTATION_SENT = "Quotation Sent"
    WAITING_APPROVAL = "Waiting Customer Approval"
    APPROVED = "Approved"
    PREPARING = "Preparing"
    READY = "Ready"
    DELIVERED = "Delivered"
    CLOSED = "Closed"
    CANCELLED = "Cancelled"
    LOST = "Lost"
    RETURNED = "Returned"

class OrderSourceEnum(str, enum.Enum):
    WHATSAPP = "WhatsApp"
    MESSENGER = "Messenger"
    PHONE_CALL = "Phone Call"
    WALK_IN = "Walk-In Customer"
    MANUAL = "Manual Entry"

order_public_number_seq = Sequence("orders_public_number_seq", start=100001)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("request_id", name="uq_orders_request_id"),
        UniqueConstraint("public_number", name="uq_orders_public_number"),
        Index("ix_orders_status_created", "status", "created_at"),
        Index("ix_orders_created_id", "created_at", "id"),
        Index("ix_orders_customer_status", "customer_id", "status"),
    )

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    public_number   = Column(BigInteger, order_public_number_seq, server_default=order_public_number_seq.next_value(), nullable=False)
    customer_id     = Column(UUID(as_uuid=True), nullable=True)  # Nullable for walk-in POS
    customer_address = Column(String(300), nullable=True)  # Address selected when the sale was recorded
    user_id         = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    assigned_to_id  = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # ── State Machine ──────
    status          = Column(String, nullable=False, default=OrderStatusEnum.DRAFT.value, index=True)
    source          = Column(String, nullable=False, default=OrderSourceEnum.WALK_IN.value)

    # ── Financials ────
    total_amount    = Column(Numeric(12, 2), nullable=False, default=0)
    tax_amount      = Column(Numeric(12, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(12, 2), nullable=False, default=0)
    shipping_cost   = Column(Numeric(12, 2), nullable=False, default=0)

    payment_method  = Column(String, default="Cash")
    notes           = Column(Text, nullable=True)
    request_id      = Column(UUID(as_uuid=True), nullable=True)
    request_fingerprint = Column(String(64), nullable=True)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    preparing_started_at = Column(DateTime(timezone=True), nullable=True)
    priority = Column(String, nullable=False, default="Normal")


class OrderItem(Base):
    __tablename__ = "order_items"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    order_id        = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    product_id      = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    unit_id         = Column(UUID(as_uuid=True), ForeignKey("product_units.id"), nullable=False)

    # ── Quantities ─────────────────
    quantity_requested  = Column(Numeric(10, 2), nullable=False)  # qty in the selling unit
    quantity_actual     = Column(Numeric(10, 2), nullable=False)  # qty in base unit (after conversion)
    conversion_factor   = Column(Numeric(10, 2), nullable=False, default=1)

    # ── Pricing ─────────────
    price_level     = Column(String, nullable=False, default="Retail")
    unit_price      = Column(Numeric(12, 2), nullable=False)  # price/selling-unit (from DB)
    total_price     = Column(Numeric(12, 2), nullable=False)  # unit_price * quantity_requested
    cost_at_sale    = Column(Numeric(12, 2), nullable=True)  # total item cost, frozen for profit reports
    tax_rate        = Column(Numeric(5, 2), nullable=True)  # quoted rate, frozen for invoices
    # Immutable bill of materials for a draft bundle; NULL marks legacy orders that need review.
    bundle_components_snapshot = Column(JSON, nullable=True)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
