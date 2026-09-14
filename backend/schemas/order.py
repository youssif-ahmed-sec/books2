from pydantic import BaseModel, ConfigDict, field_validator
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from models.order import OrderStatusEnum, OrderSourceEnum
from models.product import PriceLevelEnum


# ── Request Schemas ─────────────────────────────────────────────────────────

class OrderItemCreate(BaseModel):
    """
    Zero-Trust item input: client sends ONLY product_id, unit_id, quantity, and price_level.
    unit_price and total_price are intentionally excluded — they are fetched from the DB.
    """
    product_id:  UUID
    unit_id:     UUID                           # required — needed for unit conversion
    quantity:    float                          # qty in the selling unit (e.g., 2 boxes)
    price_level: PriceLevelEnum = PriceLevelEnum.RETAIL  # which price tier to apply


class OrderCreate(BaseModel):
    """ Used by POS. Instantly deducts inventory. """
    customer_id:     Optional[UUID] = None
    warehouse_id:    UUID                       # required — determines which stock to deduct
    status:          OrderStatusEnum = OrderStatusEnum.CLOSED
    source:          Optional[str] = "Walk-In Customer"
    discount_amount: float = 0.0
    payment_method:  str = "Cash"
    notes:           Optional[str] = None
    items:           List[OrderItemCreate]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("Order must have at least one item")
        return v

class OrderDraftCreate(BaseModel):
    """ Used by OMS. Creates an order without instant deduction. """
    customer_id:     Optional[UUID] = None
    source:          OrderSourceEnum = OrderSourceEnum.MANUAL
    status:          OrderStatusEnum = OrderStatusEnum.DRAFT
    discount_amount: float = 0.0
    shipping_cost:   float = 0.0
    payment_method:  str = "Cash"
    notes:           Optional[str] = None
    assigned_to_id:  Optional[UUID] = None
    items:           List[OrderItemCreate]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("Order must have at least one item")
        return v

class OrderStatusUpdate(BaseModel):
    status: OrderStatusEnum
    warehouse_id: Optional[UUID] = None # Required if transitioning to DELIVERED/CLOSED

# ── Response Schemas ────────────────────────────────────────────────────────

class OrderItemResponse(BaseModel):
    id:                 UUID
    order_id:           UUID
    product_id:         UUID
    unit_id:            UUID
    quantity_requested: float   # qty the cashier entered
    quantity_actual:    float   # qty deducted from stock (base units)
    conversion_factor:  float
    price_level:        str
    unit_price:         float   # server-fetched — safe to expose in response
    total_price:        float   # server-computed
    created_at:         datetime

    model_config = ConfigDict(from_attributes=True)


class OrderResponse(BaseModel):
    id:              UUID
    customer_id:     Optional[UUID] = None
    user_id:         Optional[UUID] = None
    assigned_to_id:  Optional[UUID] = None
    status:          str
    source:          Optional[str] = None
    total_amount:    float
    tax_amount:      float
    discount_amount: float
    shipping_cost:   float
    payment_method:  str
    notes:           Optional[str] = None
    created_at:      datetime
    updated_at:      Optional[datetime] = None
    items:           List[OrderItemResponse] = []

    model_config = ConfigDict(from_attributes=True)
