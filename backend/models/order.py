from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, Enum, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .user import Base
import enum
import uuid


class OrderStatusEnum(str, enum.Enum):
    """
    Postgres-backed ENUM for order status.
    Enforces a strict state machine: Draft → Quotation → Approved → Ready → Delivered.
    """
    DRAFT = "Draft"
    QUOTATION = "Quotation"
    APPROVED = "Approved"
    READY = "Ready"
    DELIVERED = "Delivered"


class Order(Base):
    __tablename__ = "orders"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    customer_id     = Column(UUID(as_uuid=True), nullable=True)  # Nullable for walk-in POS
    user_id         = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # ── State Machine — backed by Postgres ENUM type "orderstatusenum" ──────
    status = Column(
        Enum(OrderStatusEnum, name="orderstatusenum", create_type=True),
        nullable=False,
        default=OrderStatusEnum.DRAFT,
        index=True,
    )

    # ── Financials — all server-computed, stored as Numeric for precision ────
    total_amount    = Column(Numeric(12, 2), nullable=False, default=0)
    tax_amount      = Column(Numeric(12, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(12, 2), nullable=False, default=0)

    payment_method  = Column(String, default="Cash")
    notes           = Column(Text, nullable=True)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OrderItem(Base):
    __tablename__ = "order_items"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    order_id        = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    product_id      = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    unit_id         = Column(UUID(as_uuid=True), ForeignKey("product_units.id"), nullable=False)

    # ── Quantities (all server-computed via unit conversion) ─────────────────
    quantity_requested  = Column(Numeric(10, 2), nullable=False)  # qty in the selling unit
    quantity_actual     = Column(Numeric(10, 2), nullable=False)  # qty in base unit (after conversion)
    conversion_factor   = Column(Numeric(10, 2), nullable=False, default=1)

    # ── Pricing (all server-computed, never trusted from client) ─────────────
    price_level     = Column(String, nullable=False, default="Retail")
    unit_price      = Column(Numeric(12, 2), nullable=False)  # price/selling-unit (from DB)
    total_price     = Column(Numeric(12, 2), nullable=False)  # unit_price * quantity_requested

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
