from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from enum import Enum

class TransactionTypeEnum(str, Enum):
    RECEIVING = "Receiving"
    ISSUING = "Issuing"
    TRANSFER = "Transfer"
    ADJUSTMENT = "Adjustment"
    COUNTING = "Counting"

class InventoryTransactionBase(BaseModel):
    product_id: UUID
    warehouse_id: UUID
    transaction_type: TransactionTypeEnum
    quantity_changed: Decimal = Field(max_digits=18, decimal_places=2, allow_inf_nan=False)
    reference_document: Optional[str] = None
    notes: Optional[str] = None

class InventoryTransactionCreate(InventoryTransactionBase):
    supplier_id: Optional[UUID] = None
    unit_cost: Optional[Decimal] = Field(default=None, ge=0, allow_inf_nan=False)
    request_id: UUID


class StockReceiptLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    unit_cost: Optional[Decimal] = Field(default=None, ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)


class StockReceiptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    supplier_id: UUID
    warehouse_id: UUID
    supplier_document: Optional[str] = Field(default=None, max_length=200)
    lines: List[StockReceiptLine] = Field(min_length=1, max_length=100)

class InventoryTransactionResponse(InventoryTransactionBase):
    id: UUID
    user_id: UUID
    created_at: datetime
    supplier_id: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)

class InventoryBalanceResponse(BaseModel):
    id: UUID
    product_id: UUID
    warehouse_id: UUID
    current_stock: Decimal
    updated_at: datetime
    product_name: Optional[str] = None
    warehouse_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class InventoryStatsResponse(BaseModel):
    today_movements: Optional[int]
    low_stock_count: int
    critical_stock_count: int
    total_value: Decimal

class InventoryTransactionRecentResponse(InventoryTransactionResponse):
    product_name: Optional[str] = None

class PaginatedInventoryTransactionResponse(BaseModel):
    data: List[InventoryTransactionRecentResponse]
    total: int


class InventoryTransferCreate(BaseModel):
    product_id: UUID
    source_warehouse_id: UUID
    target_warehouse_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    request_id: UUID


class InventoryCountCreate(BaseModel):
    product_id: UUID
    warehouse_id: UUID
    observed_quantity: Decimal = Field(ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    request_id: UUID
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if value and len(value) < 3:
            raise ValueError("Reason must be at least 3 characters")
        return value or None


class InventoryCountResponse(BaseModel):
    id: UUID
    product_id: UUID
    warehouse_id: UUID
    user_id: UUID
    expected_quantity: Decimal
    observed_quantity: Decimal
    difference: Decimal
    session_id: Optional[UUID] = None
    reason: Optional[str] = None
    status: str = "APPROVED"
    unit_cost: Optional[Decimal] = None
    reviewed_by: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CountSessionLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: UUID
    expected_quantity: Decimal = Field(ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    observed_quantity: Decimal = Field(ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: Optional[str]) -> Optional[str]:
        return InventoryCountCreate.clean_reason(value)


class CountSessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    warehouse_id: UUID
    lines: List[CountSessionLine] = Field(min_length=1, max_length=100)


class CountRejectBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Rejection reason must be at least 3 characters")
        return value

