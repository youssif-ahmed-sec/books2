from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import List, Optional
from typing import Literal
from uuid import UUID
from datetime import datetime
from decimal import Decimal

from models.order import OrderStatusEnum, OrderSourceEnum
from models.product import PriceLevelEnum
from schemas.payment import PaymentMethod


# ── Request Schemas ─────────────────────────────────────────────────────────

class OrderItemCreate(BaseModel):
    """
    Zero-Trust item input: client sends ONLY product_id, unit_id, quantity, and price_level.
    unit_price and total_price are intentionally excluded — they are fetched from the DB.
    """
    product_id:  UUID
    unit_id:     UUID                           # required — needed for unit conversion
    quantity:    Decimal = Field(gt=0, allow_inf_nan=False)
    price_level: PriceLevelEnum = PriceLevelEnum.RETAIL  # which price tier to apply


class OrderCreate(BaseModel):
    """ Used by POS. Instantly deducts inventory. """
    customer_id:     Optional[UUID] = None
    customer_address: Optional[str] = Field(default=None, max_length=300)
    warehouse_id:    UUID                       # required — determines which stock to deduct
    status:          OrderStatusEnum = OrderStatusEnum.CLOSED
    source:          Optional[str] = "Walk-In Customer"
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False)
    discount_percent: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=5, decimal_places=2, allow_inf_nan=False)
    expected_total: Optional[Decimal] = Field(default=None, ge=0, allow_inf_nan=False)
    payment_method:  PaymentMethod = "Cash"
    amount_received: Optional[Decimal] = Field(default=None, ge=0, allow_inf_nan=False, max_digits=12, decimal_places=2)
    received_method: Optional[Literal["Cash", "Instapay", "Wallet", "Credit Card"]] = None
    notes:           Optional[str] = None
    items:           List[OrderItemCreate]
    request_id:      UUID

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("Order must have at least one item")
        return v

    @field_validator("status")
    @classmethod
    def pos_status_must_be_fulfilled(cls, value: OrderStatusEnum) -> OrderStatusEnum:
        if value not in (OrderStatusEnum.DELIVERED, OrderStatusEnum.CLOSED):
            raise ValueError("POS orders must be delivered or closed because stock is deducted immediately")
        return value

    @model_validator(mode="after")
    def validate_deferred_collection(self):
        if self.payment_method == "Deferred Payment":
            if self.customer_id is None:
                raise ValueError("Deferred payment requires a registered customer")
            if self.amount_received is None:
                raise ValueError("Enter the amount received, including zero for full credit")
            if self.amount_received > 0 and self.received_method is None:
                raise ValueError("Choose how the received amount was paid")
        elif self.amount_received is not None or self.received_method is not None:
            raise ValueError("Partial collection applies only to deferred payment")
        return self

class OrderDraftCreate(BaseModel):
    """ Used by OMS. Creates an order without instant deduction. """
    customer_id:     Optional[UUID] = None
    lead_id:         Optional[UUID] = None
    source:          OrderSourceEnum = OrderSourceEnum.MANUAL
    status:          OrderStatusEnum = OrderStatusEnum.DRAFT
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False)
    shipping_cost:   Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False)
    payment_method:  PaymentMethod = "Cash"
    notes:           Optional[str] = None
    assigned_to_id:  Optional[UUID] = None
    items:           List[OrderItemCreate]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("Order must have at least one item")
        return v

    @field_validator("status")
    @classmethod
    def draft_status_must_remain_draft(cls, value: OrderStatusEnum) -> OrderStatusEnum:
        if value != OrderStatusEnum.DRAFT:
            raise ValueError("Draft orders must start in Draft Order status")
        return value

class OrderStatusUpdate(BaseModel):
    status: OrderStatusEnum
    warehouse_id: Optional[UUID] = None # Required if transitioning to DELIVERED/CLOSED


class OrderAssignmentUpdate(BaseModel):
    user_id: UUID


class PreparedItem(BaseModel):
    order_item_id: UUID
    picked_quantity: Decimal = Field(ge=0, allow_inf_nan=False)


class OrderPreparation(BaseModel):
    items: List[PreparedItem] = Field(min_length=1)
    package_confirmed: bool


class LeadCreate(BaseModel):
    customer_id: Optional[UUID] = None
    source: OrderSourceEnum = OrderSourceEnum.PHONE_CALL
    notes: str = Field(min_length=2, max_length=5000)
    priority: Literal["Low", "Normal", "High"] = "Normal"

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
    tax_rate:           Optional[float] = None
    product_name:       Optional[str] = None
    created_at:         datetime

    model_config = ConfigDict(from_attributes=True)


class OrderResponse(BaseModel):
    id:              UUID
    public_number:   int
    customer_id:     Optional[UUID] = None
    customer_address: Optional[str] = None
    user_id:         Optional[UUID] = None
    assigned_to_id:  Optional[UUID] = None
    status:          str
    allowed_next_statuses: List[str] = []
    source:          Optional[str] = None
    priority:        str = "Normal"
    total_amount:    float
    tax_amount:      float
    discount_amount: float
    discount_percent: Optional[float] = None
    wallet_fee_amount: float = 0
    shipping_cost:   float
    payment_method:  str
    notes:           Optional[str] = None
    created_at:      datetime
    updated_at:      Optional[datetime] = None
    items:           List[OrderItemResponse] = []

    model_config = ConfigDict(from_attributes=True)


class QuotationItemResponse(OrderItemResponse):
    product_name: str
    unit_name: str = ""


class QuotationResponse(OrderResponse):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    employee_name: Optional[str] = None
    amount_received: float = 0
    received_method: Optional[str] = None
    items: List[QuotationItemResponse]
