from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from models.product import PriceLevelEnum


class OfferLineInput(BaseModel):
    component_id: UUID
    unit_id: UUID
    price_level: PriceLevelEnum
    quantity: int = Field(gt=0, le=100000)


class OfferInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    sale_price: Decimal = Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)
    components: list[OfferLineInput] = Field(min_length=1, max_length=50)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("Offer name is required")
        return cleaned


class OfferStatusInput(BaseModel):
    is_active: bool
