from pydantic import BaseModel, ConfigDict, Field
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


class InventoryCountResponse(BaseModel):
    id: UUID
    product_id: UUID
    warehouse_id: UUID
    user_id: UUID
    expected_quantity: Decimal
    observed_quantity: Decimal
    difference: Decimal
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

