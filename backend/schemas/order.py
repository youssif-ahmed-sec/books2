from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from uuid import UUID
from datetime import datetime

class OrderItemCreate(BaseModel):
    product_id: UUID
    unit_id: Optional[UUID] = None
    quantity: float
    unit_price: float
    total_price: float

class OrderItemResponse(OrderItemCreate):
    id: UUID
    order_id: UUID
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class OrderCreate(BaseModel):
    customer_id: Optional[UUID] = None
    status: str = "Completed"
    total_amount: float
    tax_amount: float
    discount_amount: float = 0.0
    payment_method: str = "Cash"
    notes: Optional[str] = None
    items: List[OrderItemCreate]

class OrderResponse(BaseModel):
    id: UUID
    customer_id: Optional[UUID] = None
    user_id: Optional[UUID] = None
    status: str
    total_amount: float
    tax_amount: float
    discount_amount: float
    payment_method: str
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    items: List[OrderItemResponse] = []
    
    model_config = ConfigDict(from_attributes=True)
