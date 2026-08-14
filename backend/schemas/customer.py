from pydantic import BaseModel, ConfigDict
from typing import Optional
from uuid import UUID
from datetime import datetime
from models.product import PriceLevelEnum

class CustomerBase(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    price_level: PriceLevelEnum = PriceLevelEnum.RETAIL

class CustomerCreate(CustomerBase):
    pass

class CustomerUpdate(CustomerBase):
    name: Optional[str] = None
    price_level: Optional[PriceLevelEnum] = None
    is_active: Optional[bool] = None

class CustomerResponse(CustomerBase):
    id: UUID
    balance: float
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)
