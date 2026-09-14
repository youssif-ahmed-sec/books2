from pydantic import BaseModel, ConfigDict
from typing import Optional
from uuid import UUID
from datetime import datetime
from decimal import Decimal

class ExpenseBase(BaseModel):
    category: str
    amount: Decimal
    description: Optional[str] = None

class ExpenseCreate(ExpenseBase):
    pass

class ExpenseResponse(ExpenseBase):
    id: UUID
    expense_date: datetime
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class IncomeBase(BaseModel):
    source: str
    amount: Decimal
    description: Optional[str] = None

class IncomeCreate(IncomeBase):
    pass

class IncomeResponse(IncomeBase):
    id: UUID
    income_date: datetime
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
