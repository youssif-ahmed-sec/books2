from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from schemas.order import OrderItemCreate


class ReturnLineCreate(BaseModel):
    order_item_id: UUID
    quantity: Decimal = Field(gt=0, allow_inf_nan=False)


class SalesReturnCreate(BaseModel):
    order_id: UUID
    warehouse_id: UUID
    kind: Literal["REFUND", "EXCHANGE"]
    lines: list[ReturnLineCreate] = Field(min_length=1)
    replacements: list[OrderItemCreate] = Field(default_factory=list)
    settlement_confirmed: bool = False
    request_id: UUID

    @model_validator(mode="after")
    def validate_exchange(self):
        if self.kind == "EXCHANGE" and not self.replacements:
            raise ValueError("Exchange requires replacement items")
        if self.kind == "REFUND" and self.replacements:
            raise ValueError("Refund cannot contain replacement items")
        if len({line.order_item_id for line in self.lines}) != len(self.lines):
            raise ValueError("Each original item can appear only once")
        return self


class SalesReturnResponse(BaseModel):
    id: UUID
    order_id: UUID
    exchange_order_id: UUID | None
    warehouse_id: UUID
    user_id: UUID
    kind: str
    payment_method: str
    refund_amount: Decimal
    charge_amount: Decimal
    returned_value: Decimal
    replacement_value: Decimal
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
