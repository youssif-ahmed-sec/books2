from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from schemas.order import OrderItemCreate


class ReturnLineCreate(BaseModel):
    order_item_id: UUID
    quantity: Decimal = Field(gt=0, multiple_of=Decimal("0.01"), allow_inf_nan=False)


class SalesReturnCreate(BaseModel):
    order_id: UUID
    warehouse_id: UUID
    kind: Literal["REFUND", "EXCHANGE"]
    lines: list[ReturnLineCreate] = Field(min_length=1)
    replacements: list[OrderItemCreate] = Field(default_factory=list)
    settlement_confirmed: bool = False
    expected_refund_amount: Decimal | None = Field(default=None, ge=0, allow_inf_nan=False)
    expected_charge_amount: Decimal | None = Field(default=None, ge=0, allow_inf_nan=False)
    request_id: UUID

    @model_validator(mode="after")
    def validate_exchange(self):
        if self.kind == "EXCHANGE" and not self.replacements:
            raise ValueError("Exchange requires replacement items")
        if self.kind == "REFUND" and self.replacements:
            raise ValueError("Refund cannot contain replacement items")
        if len({line.order_item_id for line in self.lines}) != len(self.lines):
            raise ValueError("Each original item can appear only once")
        if any(item.quantity % Decimal("0.01") != 0 for item in self.replacements):
            raise ValueError("Replacement quantity must have at most two decimal places")
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


class SalesReturnPreview(BaseModel):
    payment_method: str
    returned_value: Decimal
    replacement_value: Decimal
    refund_amount: Decimal
    charge_amount: Decimal


class ReturnReceiptLine(BaseModel):
    product_name: str
    unit_name: str
    quantity: Decimal
    amount: Decimal


class SalesReturnReceipt(BaseModel):
    id: UUID
    order_id: UUID
    exchange_order_id: UUID | None
    kind: str
    payment_method: str
    created_at: datetime
    employee_name: str = ""
    customer_name: str | None = None
    customer_phone: str | None = None
    returned_value: Decimal
    replacement_value: Decimal
    refund_amount: Decimal
    charge_amount: Decimal
    returned_lines: list[ReturnReceiptLine]
    replacement_lines: list[ReturnReceiptLine]
