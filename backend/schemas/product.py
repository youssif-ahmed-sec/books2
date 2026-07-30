from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from models.product import PriceLevelEnum

class ProductPriceBase(BaseModel):
    price_level: PriceLevelEnum
    price: float

class ProductPriceCreate(ProductPriceBase):
    pass

class ProductPriceResponse(ProductPriceBase):
    id: UUID
    product_id: UUID
    unit_id: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)

class ProductUnitBase(BaseModel):
    unit_name: str
    conversion_factor: float
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
    cost: float = 0
    tax_rate: float = 0
    min_stock_level: float = 0
    is_active: bool = True

class ProductCreate(ProductBase):
    units: List[ProductUnitCreate] = []

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
    cost: Optional[float] = None
    tax_rate: Optional[float] = None
    min_stock_level: Optional[float] = None
    is_active: Optional[bool] = None
    
    units: Optional[List[ProductUnitCreate]] = None

class ProductResponse(ProductBase):
    id: UUID
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    units: List[ProductUnitResponse] = []

    model_config = ConfigDict(from_attributes=True)

class CategoryResponse(BaseModel):
    id: UUID
    name_en: str
    name_ar: str
    
    model_config = ConfigDict(from_attributes=True)
