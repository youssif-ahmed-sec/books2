from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PurchaseLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: UUID
    unit_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)


class PurchaseDocumentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    supplier_id: UUID
    note: str | None = Field(default=None, max_length=500)
    lines: list[PurchaseLineInput] = Field(min_length=1, max_length=100)


class PurchaseDocumentCreate(PurchaseDocumentInput):
    request_id: UUID


class PurchaseReceiptLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line_id: UUID
    base_quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)


class PurchaseReceiptInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    warehouse_id: UUID
    lines: list[PurchaseReceiptLineInput] = Field(min_length=1, max_length=100)


class PurchaseLineResponse(BaseModel):
    id: UUID
    product_id: UUID
    unit_id: UUID
    product_name: str
    unit_name: str
    base_unit_name: str
    quantity: Decimal
    conversion_factor: Decimal
    base_quantity: Decimal
    received_base_quantity: Decimal
    model_config = ConfigDict(from_attributes=True)


class PurchaseReceiptLineResponse(BaseModel):
    document_line_id: UUID
    base_quantity: Decimal
    model_config = ConfigDict(from_attributes=True)


class PurchaseReceiptResponse(BaseModel):
    id: UUID
    warehouse_id: UUID
    received_by: UUID
    created_at: datetime
    lines: list[PurchaseReceiptLineResponse]
    model_config = ConfigDict(from_attributes=True)


class PurchaseDocumentResponse(BaseModel):
    id: UUID
    supplier_id: UUID
    supplier_name: str
    status: str
    note: str | None
    requested_by: UUID
    approved_by: UUID | None
    ordered_at: datetime | None
    created_at: datetime
    lines: list[PurchaseLineResponse]
    receipts: list[PurchaseReceiptResponse]
    model_config = ConfigDict(from_attributes=True)
