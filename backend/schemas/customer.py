from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List
from decimal import Decimal
from uuid import UUID
from datetime import datetime
from models.product import PriceLevelEnum
from models.customer import CustomerTypeEnum
from typing import Literal

class CustomerBase(BaseModel):
    name: str
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    customer_type: CustomerTypeEnum = CustomerTypeEnum.RETAIL
    price_level: PriceLevelEnum = PriceLevelEnum.RETAIL
    tags: Optional[List[str]] = Field(default_factory=list)
    notes: Optional[str] = None
    favorite_categories: Optional[List[str]] = Field(default_factory=list)

class CustomerCreate(CustomerBase):
    pass

class CustomerUpdate(CustomerBase):
    name: Optional[str] = None
    price_level: Optional[PriceLevelEnum] = None
    customer_type: Optional[CustomerTypeEnum] = None
    is_active: Optional[bool] = None

class CustomerResponse(CustomerBase):
    id: UUID
    balance: Optional[float] = None
    credit_limit: Optional[float] = None
    purchase_count: int
    total_purchases: float
    average_purchase: float
    last_purchase_date: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)


class CreditLimitUpdate(BaseModel):
    credit_limit: Decimal = Field(ge=0, allow_inf_nan=False)


class InteractionCreate(BaseModel):
    channel: Literal["Phone Call", "In Person", "Other"]
    note: str = Field(min_length=2, max_length=5000)
    follow_up_at: Optional[datetime] = None


class InteractionResponse(InteractionCreate):
    id: UUID
    customer_id: UUID
    user_id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
