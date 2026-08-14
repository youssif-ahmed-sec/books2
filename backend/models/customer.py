from sqlalchemy import Column, String, Boolean, DateTime, Enum, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from .user import Base
from .product import PriceLevelEnum

class Customer(Base):
    __tablename__ = "customers"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True, index=True)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    
    price_level = Column(Enum(PriceLevelEnum, name="pricelevelenum", create_type=False), nullable=False, default=PriceLevelEnum.RETAIL)
    
    balance = Column(Numeric(12, 2), nullable=False, default=0) # For deferred payments/credit
    
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
