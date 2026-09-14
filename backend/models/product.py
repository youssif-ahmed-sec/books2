from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum, Numeric, UniqueConstraint
from sqlalchemy.orm import relationship
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
    # Extended fields
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    tax_number = Column(String, nullable=True)
    opening_balance = Column(Numeric(18, 2), nullable=False, default=0)
    credit_limit = Column(Numeric(18, 2), nullable=True)
    payment_terms_days = Column(String, nullable=True)  # e.g. "30", "COD"
    notes = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    payments = relationship("SupplierPayment", back_populates="supplier", cascade="all, delete-orphan")


class PaymentMethodEnum(str, enum.Enum):
    CASH = "Cash"
    BANK_TRANSFER = "Bank Transfer"
    CHECK = "Check"
    OTHER = "Other"


class SupplierPayment(Base):
    __tablename__ = "supplier_payments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False)
    payment_method = Column(Enum(PaymentMethodEnum), nullable=False, default=PaymentMethodEnum.CASH)
    reference_number = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    payment_date = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    supplier = relationship("Supplier", back_populates="payments")


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
    cost = Column(Numeric(18, 2), nullable=False, default=0)
    tax_rate = Column(Numeric(5, 2), nullable=False, default=0)
    min_stock_level = Column(Numeric(18, 2), nullable=False, default=0)
    max_stock_level = Column(Numeric(18, 2), nullable=False, default=0)
    description = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    
    is_bundle = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    units = relationship("ProductUnit", back_populates="product", cascade="all, delete-orphan")
    bundle_components = relationship(
        "ProductBundleComponent",
        foreign_keys="ProductBundleComponent.bundle_id",
        back_populates="bundle",
        cascade="all, delete-orphan",
    )
    category = relationship("Category")
    subcategory = relationship("Subcategory")
    brand = relationship("Brand")
    supplier = relationship("Supplier")

class GlobalUnit(Base):
    __tablename__ = "global_units"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, unique=True, nullable=False)
    conversion_factor = Column(Numeric(18, 2), nullable=False, default=1)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ProductUnit(Base):
    __tablename__ = "product_units"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    unit_name = Column(String, nullable=False)
    conversion_factor = Column(Numeric(18, 2), nullable=False)
    barcode = Column(String, unique=True, nullable=True)
    is_deleted = Column(Boolean, default=False)

    product = relationship("Product", back_populates="units")
    prices = relationship("ProductPrice", back_populates="unit", cascade="all, delete-orphan")

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
    price = Column(Numeric(18, 2), nullable=False)
    is_deleted = Column(Boolean, default=False)

    unit = relationship("ProductUnit", back_populates="prices")

    __table_args__ = (
        UniqueConstraint('product_id', 'unit_id', 'price_level', name='uix_product_unit_pricelevel'),
    )

class ProductBundleComponent(Base):
    __tablename__ = "product_bundle_components"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bundle_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    component_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    quantity = Column(Numeric(10, 2), nullable=False)  # Quantity in the component's base_unit
    
    bundle = relationship("Product", foreign_keys=[bundle_id], back_populates="bundle_components")
    component = relationship("Product", foreign_keys=[component_id])
