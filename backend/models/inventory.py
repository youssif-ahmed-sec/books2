from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum, Numeric
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
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    current_stock = Column(Numeric(10, 2), nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

class TransactionTypeEnum(str, enum.Enum):
    RECEIVING = "Receiving"
    ISSUING = "Issuing"
    TRANSFER = "Transfer"
    ADJUSTMENT = "Adjustment"
    COUNTING = "Counting"

class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    transaction_type = Column(Enum(TransactionTypeEnum), nullable=False)
    quantity_changed = Column(Numeric(10, 2), nullable=False)
    reference_document = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
