from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


PaymentMethod = Literal["Cash", "Wallet", "Vodafone Cash", "Bank Transfer", "Instapay", "Credit Card", "Deferred Payment"]
CollectedPaymentMethod = Literal["Cash", "Vodafone Cash", "Bank Transfer", "Instapay", "Credit Card"]


class CustomerPaymentCreate(BaseModel):
    request_id: UUID
    amount: Decimal = Field(gt=0, allow_inf_nan=False)
    method: CollectedPaymentMethod


class PaymentResponse(BaseModel):
    id: UUID
    order_id: UUID | None
    customer_id: UUID | None
    user_id: UUID
    amount: Decimal
    method: str
    kind: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
