from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum, Numeric, UniqueConstraint, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import enum
import uuid
from .user import Base

class Warehouse(Base):
    __tablename__ = "warehouses"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    location = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class InventoryBalance(Base):
    __tablename__ = "inventory_balances"
    __table_args__ = (
        UniqueConstraint("product_id", "warehouse_id", name="uq_inventory_balance_product_warehouse"),
        CheckConstraint("current_stock >= 0", name="ck_inventory_balance_nonnegative"),
    )
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    current_stock = Column(Numeric(18, 2), nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

class TransactionTypeEnum(str, enum.Enum):
    RECEIVING = "Receiving"
    ISSUING = "Issuing"
    TRANSFER = "Transfer"
    ADJUSTMENT = "Adjustment"
    COUNTING = "Counting"

class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"
    __table_args__ = (UniqueConstraint("request_id", name="uq_inventory_transactions_request_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    transaction_type = Column(Enum(TransactionTypeEnum), nullable=False)
    quantity_changed = Column(Numeric(18, 2), nullable=False)
    # Receipt facts must remain stable when the product's current cost or supplier changes.
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=True)
    unit_cost = Column(Numeric(18, 2), nullable=True)
    reference_document = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    request_id = Column(UUID(as_uuid=True), nullable=True)
    request_fingerprint = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
