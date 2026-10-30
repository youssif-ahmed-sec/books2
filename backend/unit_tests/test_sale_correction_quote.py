from decimal import Decimal
from uuid import uuid4

import pytest

from schemas.order import OrderCreate
from services.sale_correction_pricing import PricedCorrectionLine
from services.sale_correction_quote import quote_correction


def proposal(**values):
    product_id, unit_id = uuid4(), uuid4()
    data = {"request_id": uuid4(), "warehouse_id": uuid4(),
            "items": [{"product_id": product_id, "unit_id": unit_id, "quantity": 1}]}
    data.update(values)
    line = PricedCorrectionLine(product_id, unit_id, "Retail", Decimal("1"), Decimal("100"), Decimal("1"), None, None)
    return OrderCreate(**data), [line]


def test_cash_quote_and_discount_validation():
    order, lines = proposal(discount_amount=10, discount_percent=10, expected_total=90)
    quote = quote_correction(order, lines)
    assert quote.total == 90 and quote.collected == 90 and quote.deferred_remaining == 0
    with pytest.raises(ValueError, match="total changed"):
        quote_correction(order.model_copy(update={"expected_total": Decimal("91")}), lines)
    with pytest.raises(ValueError, match="percentage"):
        quote_correction(order.model_copy(update={"discount_percent": Decimal("11")}), lines)


def test_wallet_and_part_paid_deferred_quote_match_checkout_rules():
    order, lines = proposal(payment_method="Wallet")
    quote = quote_correction(order, lines)
    assert quote.wallet_fee == 1 and quote.total == 101 and quote.collected == 101
    deferred, lines = proposal(payment_method="Deferred Payment", customer_id=uuid4(), amount_received=20,
                               received_method="Wallet", expected_collection_method="Cash", next_due_date="2099-01-01")
    quote = quote_correction(deferred, lines)
    assert quote.wallet_fee == Decimal("0.20") and quote.total == Decimal("100.20")
    assert quote.collected == Decimal("20.20") and quote.deferred_remaining == 80


def test_quote_rejects_invalid_due_and_excess_collection():
    order, lines = proposal(payment_method="Deferred Payment", customer_id=uuid4(), amount_received=20,
                            received_method="Cash", expected_collection_method="Cash", next_due_date="2099-01-01")
    with pytest.raises(ValueError, match="cannot exceed"):
        quote_correction(order.model_copy(update={"amount_received": Decimal("101")}), lines)
    with pytest.raises(ValueError, match="due date"):
        quote_correction(order.model_copy(update={"next_due_date": None}), lines)
