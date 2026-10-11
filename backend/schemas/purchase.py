from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PurchaseRequestCreate(BaseModel):
    product_id: UUID
    supplier_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)


class PurchaseReceive(BaseModel):
    warehouse_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    unit_cost: Decimal = Field(ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    request_id: UUID


class PurchaseOrderResponse(BaseModel):
    id: UUID
    product_id: UUID
    supplier_id: UUID
    quantity: Decimal
    received_quantity: Decimal
    status: str
    requested_by: UUID
    approved_by: UUID | None
    ordered_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
