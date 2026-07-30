from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base
import uuid
import datetime

class Order(Base):
    __tablename__ = "orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    customer_id = Column(UUID(as_uuid=True), nullable=True) # Nullable for walk-in POS customers
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String, default="Completed", index=True) # Pending, Completed, Cancelled
    total_amount = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    payment_method = Column(String, default="Cash")
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    unit_id = Column(UUID(as_uuid=True), nullable=True)
    
    quantity = Column(Float, nullable=False)
    unit_price = Column(Float, nullable=False)
    total_price = Column(Float, nullable=False)
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
