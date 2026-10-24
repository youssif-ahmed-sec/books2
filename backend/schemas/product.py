from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Literal
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal
from models.product import PriceLevelEnum, PaymentMethodEnum

class ProductPriceBase(BaseModel):
    price_level: PriceLevelEnum
    price: Decimal = Field(ge=0, allow_inf_nan=False)

class ProductPriceCreate(ProductPriceBase):
    pass


class SupplierSalePrice(ProductPriceBase):
    unit_id: UUID
    price: Decimal = Field(gt=0, allow_inf_nan=False)


class ProductSupplierPricesCreate(BaseModel):
    supplier_id: UUID
    prices: List[SupplierSalePrice] = Field(min_length=1)

class ProductPriceResponse(ProductPriceBase):
    id: UUID
    product_id: UUID
    unit_id: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)

class GlobalUnitBase(BaseModel):
    name: str
    conversion_factor: Decimal = Field(gt=0, allow_inf_nan=False)

class GlobalUnitCreate(GlobalUnitBase):
    pass

class GlobalUnitResponse(GlobalUnitBase):
    id: UUID
    is_deleted: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class ProductUnitBase(BaseModel):
    unit_name: str
    conversion_factor: Decimal = Field(gt=0, allow_inf_nan=False)
    barcode: Optional[str] = None

class ProductUnitCreate(ProductUnitBase):
    id: Optional[UUID] = None
    prices: List[ProductPriceCreate] = []

class ProductUnitResponse(ProductUnitBase):
    id: UUID
    product_id: UUID
    prices: List[ProductPriceResponse] = []

    model_config = ConfigDict(from_attributes=True)

class ProductBundleComponentBase(BaseModel):
    component_id: UUID
    quantity: Decimal = Field(gt=0, allow_inf_nan=False)
    unit_id: Optional[UUID] = None
    price_level: Optional[PriceLevelEnum] = None

class ProductBundleComponentCreate(ProductBundleComponentBase):
    pass

class ProductBundleComponentResponse(ProductBundleComponentBase):
    id: UUID
    bundle_id: UUID

    model_config = ConfigDict(from_attributes=True)

class ProductBase(BaseModel):
    sku: str
    barcode: Optional[str] = None
    name_en: Optional[str] = ""
    name_ar: str
    category_id: Optional[UUID] = None
    subcategory_id: Optional[UUID] = None
    brand_id: Optional[UUID] = None
    supplier_id: Optional[UUID] = None
    
    base_unit: str
    cost: Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False)
    tax_rate: Decimal = Decimal("0")
    min_stock_level: Decimal = Decimal("0")
    max_stock_level: Decimal = Decimal("0")
    description: Optional[str] = None
    image_url: Optional[str] = None
    warehouse_location: Optional[str] = None
    is_bundle: bool = False
    is_active: bool = True

class ProductCreate(ProductBase):
    category_id: UUID
    subcategory_id: UUID
    brand_id: UUID
    supplier_id: UUID
    units: List[ProductUnitCreate] = []
    bundle_components: List[ProductBundleComponentCreate] = []
    initial_stock: Decimal = Field(default=Decimal("0"), ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)

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
    warehouse_location: Optional[str] = None
    is_bundle: Optional[bool] = None
    is_active: Optional[bool] = None
    
    units: Optional[List[ProductUnitCreate]] = None
    bundle_components: Optional[List[ProductBundleComponentCreate]] = None
    model_config = ConfigDict(extra="forbid")

class CategoryBase(BaseModel):
    name_ar: str
    name_en: str = ""

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
    name_ar: str
    name_en: str = ""

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
    name_ar: str
    name_en: str = ""

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


class QuickSupplierCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)

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
    opening_balance: Optional[Decimal] = None
    id: UUID
    model_config = ConfigDict(from_attributes=True)

class SupplierAllocationCreate(BaseModel):
    debt_entry_id: UUID
    amount: Decimal = Field(gt=0, allow_inf_nan=False, max_digits=18, decimal_places=2)


class SupplierPaymentCreate(BaseModel):
    request_id: UUID
    amount: Decimal = Field(gt=0, allow_inf_nan=False, max_digits=18, decimal_places=2)
    payment_method: PaymentMethodEnum = PaymentMethodEnum.CASH
    cash_source: Optional[Literal["SHIFT", "OUTSIDE_SHIFT"]] = None
    reference_number: Optional[str] = None
    notes: Optional[str] = None
    allocations: List[SupplierAllocationCreate] = []
    allow_unallocated: bool = False


class SupplierAllocationResponse(BaseModel):
    debt_entry_id: UUID
    amount: Decimal
    model_config = ConfigDict(from_attributes=True)

class SupplierPaymentResponse(BaseModel):
    id: UUID
    supplier_id: UUID
    amount: Decimal
    payment_method: str
    cash_source: Optional[str] = None
    reference_number: Optional[str] = None
    notes: Optional[str] = None
    payment_date: datetime
    allocations: List[SupplierAllocationResponse] = []
    model_config = ConfigDict(from_attributes=True)


class SupplierDebtCreate(BaseModel):
    request_id: UUID
    amount: Decimal = Field(gt=0, allow_inf_nan=False, max_digits=18, decimal_places=2)
    note: str = Field(min_length=2, max_length=500)
    reference_number: Optional[str] = Field(default=None, max_length=100)
    due_date: date
    approved_credit_limit: Optional[Decimal] = Field(default=None, ge=0, allow_inf_nan=False, max_digits=18, decimal_places=2)


class SupplierDebtReverse(BaseModel):
    request_id: UUID
    reason: str = Field(min_length=2, max_length=500)


class SupplierDebtEntryResponse(BaseModel):
    id: UUID
    supplier_id: UUID
    entry_type: str
    amount: Decimal
    note: str
    reference_number: Optional[str] = None
    due_date: Optional[date] = None
    allocated_amount: Decimal = Decimal("0")
    reverses_entry_id: Optional[UUID] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SupplierDetailResponse(SupplierResponse):
    total_purchases: Optional[Decimal] = None
    total_manual_debt: Optional[Decimal] = None
    total_payments: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    statement_incomplete: bool = False
    unpriced_receipts: int = 0
    unattributed_receipts: int = 0
    payments: List[SupplierPaymentResponse] = []
    debt_entries: List[SupplierDebtEntryResponse] = []
    model_config = ConfigDict(from_attributes=True)

class PaginatedSupplierResponse(BaseModel):
    data: List[SupplierResponse]
    total: int

class ProductSupplierSummary(BaseModel):
    id: UUID
    name: str

    model_config = ConfigDict(from_attributes=True)


class ProductResponse(ProductBase):
    cost: Optional[Decimal] = Field(default=None, ge=0, allow_inf_nan=False)
    id: UUID
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    units: List[ProductUnitResponse] = []
    bundle_components: List[ProductBundleComponentResponse] = []
    category: Optional[CategoryResponse] = None
    subcategory: Optional[SubcategoryResponse] = None
    brand: Optional[BrandResponse] = None
    supplier: Optional[ProductSupplierSummary] = None
    current_stock: Decimal = Decimal("0")

    model_config = ConfigDict(from_attributes=True)

class PaginatedProductResponse(BaseModel):
    data: List[ProductResponse]
    total: int
