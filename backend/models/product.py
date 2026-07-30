from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import enum
import uuid
from .user import Base

class Category(Base):
    __tablename__ = "categories"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name_en = Column(String, nullable=False)
    name_ar = Column(String, nullable=False)
    is_deleted = Column(Boolean, default=False)

class Subcategory(Base):
    __tablename__ = "subcategories"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False)
    name_en = Column(String, nullable=False)
    name_ar = Column(String, nullable=False)
    is_deleted = Column(Boolean, default=False)

class Brand(Base):
    __tablename__ = "brands"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name_en = Column(String, nullable=False)
    name_ar = Column(String, nullable=False)
    is_deleted = Column(Boolean, default=False)

class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    contact_info = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False)

class Product(Base):
    __tablename__ = "products"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku = Column(String, unique=True, index=True, nullable=False)
    barcode = Column(String, unique=True, index=True, nullable=True)
    name_en = Column(String, nullable=False)
    name_ar = Column(String, nullable=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"))
    subcategory_id = Column(UUID(as_uuid=True), ForeignKey("subcategories.id"))
    brand_id = Column(UUID(as_uuid=True), ForeignKey("brands.id"))
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("suppliers.id"))
    
    base_unit = Column(String, nullable=False)
    cost = Column(Numeric(10, 2), nullable=False, default=0)
    tax_rate = Column(Numeric(5, 2), nullable=False, default=0)
    min_stock_level = Column(Numeric(10, 2), nullable=False, default=0)
    
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class ProductUnit(Base):
    __tablename__ = "product_units"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    unit_name = Column(String, nullable=False)
    conversion_factor = Column(Numeric(10, 2), nullable=False)
    barcode = Column(String, unique=True, nullable=True)
    is_deleted = Column(Boolean, default=False)

class PriceLevelEnum(str, enum.Enum):
    RETAIL = "Retail"
    SEMI_WHOLESALE = "Semi Wholesale"
    WHOLESALE = "Wholesale"
    SUPER_WHOLESALE = "Super Wholesale"
    VIP = "VIP"

class ProductPrice(Base):
    __tablename__ = "product_prices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    unit_id = Column(UUID(as_uuid=True), ForeignKey("product_units.id"), nullable=True)
    price_level = Column(Enum(PriceLevelEnum), nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    is_deleted = Column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint('product_id', 'unit_id', 'price_level', name='uix_product_unit_pricelevel'),
    )
