from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from models.product import PriceLevelEnum

class ProductPriceBase(BaseModel):
    price_level: PriceLevelEnum
    price: Decimal

class ProductPriceCreate(ProductPriceBase):
    pass

class ProductPriceResponse(ProductPriceBase):
    id: UUID
    product_id: UUID
    unit_id: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)

class GlobalUnitBase(BaseModel):
    name: str
    conversion_factor: Decimal

class GlobalUnitCreate(GlobalUnitBase):
    pass

class GlobalUnitResponse(GlobalUnitBase):
    id: UUID
    is_deleted: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class ProductUnitBase(BaseModel):
    unit_name: str
    conversion_factor: Decimal
    barcode: Optional[str] = None

class ProductUnitCreate(ProductUnitBase):
    prices: List[ProductPriceCreate] = []

class ProductUnitResponse(ProductUnitBase):
    id: UUID
    product_id: UUID
    prices: List[ProductPriceResponse] = []

    model_config = ConfigDict(from_attributes=True)

class ProductBase(BaseModel):
    sku: str
    barcode: Optional[str] = None
    name_en: str
    name_ar: str
    category_id: Optional[UUID] = None
    subcategory_id: Optional[UUID] = None
    brand_id: Optional[UUID] = None
    supplier_id: Optional[UUID] = None
    
    base_unit: str
    cost: Decimal = Decimal("0")
    tax_rate: Decimal = Decimal("0")
    min_stock_level: Decimal = Decimal("0")
    max_stock_level: Decimal = Decimal("0")
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_active: bool = True

class ProductCreate(ProductBase):
    units: List[ProductUnitCreate] = []
    initial_stock: Decimal = Decimal("0")

class ProductUpdate(BaseModel):
    sku: Optional[str] = None
    barcode: Optional[str] = None
    name_en: Optional[str] = None
    name_ar: Optional[str] = None
    category_id: Optional[UUID] = None
    subcategory_id: Optional[UUID] = None
    brand_id: Optional[UUID] = None
    supplier_id: Optional[UUID] = None
    
    base_unit: Optional[str] = None
    cost: Optional[Decimal] = None
    tax_rate: Optional[Decimal] = None
    min_stock_level: Optional[Decimal] = None
    max_stock_level: Optional[Decimal] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None
    
    units: Optional[List[ProductUnitCreate]] = None
    total_stock: Optional[Decimal] = None

class CategoryBase(BaseModel):
    name_en: str
    name_ar: str

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name_en: Optional[str] = None
    name_ar: Optional[str] = None

class CategoryResponse(CategoryBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)

class SubcategoryBase(BaseModel):
    category_id: UUID
    name_en: str
    name_ar: str

class SubcategoryCreate(SubcategoryBase):
    pass

class SubcategoryUpdate(BaseModel):
    category_id: Optional[UUID] = None
    name_en: Optional[str] = None
    name_ar: Optional[str] = None

class SubcategoryResponse(SubcategoryBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)

class BrandBase(BaseModel):
    name_en: str
    name_ar: str

class BrandCreate(BrandBase):
    pass

class BrandUpdate(BaseModel):
    name_en: Optional[str] = None
    name_ar: Optional[str] = None

class BrandResponse(BrandBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)

class SupplierBase(BaseModel):
    name: str
    contact_info: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_number: Optional[str] = None
    opening_balance: Decimal = Decimal("0")
    credit_limit: Optional[Decimal] = None
    payment_terms_days: Optional[str] = None
    notes: Optional[str] = None

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_info: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_number: Optional[str] = None
    opening_balance: Optional[Decimal] = None
    credit_limit: Optional[Decimal] = None
    payment_terms_days: Optional[str] = None
    notes: Optional[str] = None

class SupplierResponse(SupplierBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)

class SupplierPaymentCreate(BaseModel):
    amount: Decimal
    payment_method: str = "Cash"
    reference_number: Optional[str] = None
    notes: Optional[str] = None

class SupplierPaymentResponse(BaseModel):
    id: UUID
    supplier_id: UUID
    amount: Decimal
    payment_method: str
    reference_number: Optional[str] = None
    notes: Optional[str] = None
    payment_date: datetime
    model_config = ConfigDict(from_attributes=True)

class SupplierDetailResponse(SupplierBase):
    id: UUID
    total_purchases: Decimal = Decimal("0")
    total_payments: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")
    payments: List[SupplierPaymentResponse] = []
    model_config = ConfigDict(from_attributes=True)

class PaginatedSupplierResponse(BaseModel):
    data: List[SupplierResponse]
    total: int

class ProductResponse(ProductBase):
    id: UUID
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    units: List[ProductUnitResponse] = []
    category: Optional[CategoryResponse] = None
    current_stock: Decimal = Decimal("0")

    model_config = ConfigDict(from_attributes=True)

class PaginatedProductResponse(BaseModel):
    data: List[ProductResponse]
    total: int
