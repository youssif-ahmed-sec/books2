from sqlalchemy import Column, String, Boolean, DateTime, Enum, Numeric, Integer, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum
from .user import Base
from .product import PriceLevelEnum

class CustomerTypeEnum(str, enum.Enum):
    RETAIL = "Retail Customer"
    STUDENT = "Student"
    TEACHER = "Teacher"
    SCHOOL = "School"
    NURSERY = "NURSERY"
    SPEECH_THERAPY = "Speech Therapy Center"
    WHOLESALE = "Wholesale Customer"
    SUPER_WHOLESALE = "Super Wholesale Customer"
    VIP = "VIP Customer"

class Customer(Base):
    __tablename__ = "customers"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True, index=True)
    whatsapp_number = Column(String, nullable=True, index=True)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    
    customer_type = Column(Enum(CustomerTypeEnum, name="customertypeenum", create_type=False), nullable=False, default=CustomerTypeEnum.RETAIL)
    price_level = Column(Enum(PriceLevelEnum, name="pricelevelenum", create_type=False), nullable=False, default=PriceLevelEnum.RETAIL)
    
    balance = Column(Numeric(12, 2), nullable=False, default=0) # For deferred payments/credit
    
    # CRM Fields
    tags = Column(JSON, nullable=True, default=[])
    notes = Column(Text, nullable=True)
    purchase_count = Column(Integer, nullable=False, default=0)
    total_purchases = Column(Numeric(12, 2), nullable=False, default=0)
    average_purchase = Column(Numeric(12, 2), nullable=False, default=0)
    last_purchase_date = Column(DateTime(timezone=True), nullable=True)
    favorite_categories = Column(JSON, nullable=True, default=[])

    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
