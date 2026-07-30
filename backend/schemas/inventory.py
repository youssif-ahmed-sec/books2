from pydantic import BaseModel, ConfigDict
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
    quantity_changed: Decimal
    reference_document: Optional[str] = None
    notes: Optional[str] = None

class InventoryTransactionCreate(InventoryTransactionBase):
    pass

class InventoryTransactionResponse(InventoryTransactionBase):
    id: UUID
    user_id: UUID
    created_at: datetime

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
    today_movements: int
    low_stock_count: int
    critical_stock_count: int
    total_value: Decimal

class InventoryTransactionRecentResponse(InventoryTransactionResponse):
    product_name: Optional[str] = None
