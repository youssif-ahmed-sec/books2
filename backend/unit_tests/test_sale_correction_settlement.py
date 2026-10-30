from decimal import Decimal

import pytest

from services.sale_correction_settlement import PaymentDelta, payment_deltas


def test_same_method_only_records_difference():
    assert payment_deltas({"Cash": Decimal("100")}, {"Cash": Decimal("125")}) == [
        PaymentDelta("Cash", "SALE", Decimal("25.00")),
    ]
    assert payment_deltas({"Cash": Decimal("100")}, {"Cash": Decimal("80")}) == [
        PaymentDelta("Cash", "REFUND", Decimal("20.00")),
    ]
    assert payment_deltas({"Cash": Decimal("100")}, {"Cash": Decimal("100")}) == []


def test_changed_method_reverses_old_and_records_new():
    assert payment_deltas({"Cash": Decimal("100")}, {"Credit Card": Decimal("100")}) == [
        PaymentDelta("Cash", "REFUND", Decimal("100.00")),
        PaymentDelta("Credit Card", "SALE", Decimal("100.00")),
    ]
    assert payment_deltas({"Credit Card": Decimal("100")}, {"Cash": Decimal("100")}) == [
        PaymentDelta("Credit Card", "REFUND", Decimal("100.00")),
        PaymentDelta("Cash", "SALE", Decimal("100.00")),
    ]


@pytest.mark.parametrize("amount", [Decimal("-1"), Decimal("NaN"), Decimal("Infinity"), Decimal("0.001"), Decimal("10000000000"), 0.1])
def test_rejects_invalid_money(amount):
    with pytest.raises(ValueError):
        payment_deltas({"Cash": amount}, {})


def test_deferred_balance_is_not_mistaken_for_collected_payment():
    with pytest.raises(ValueError):
        payment_deltas({"Deferred Payment": Decimal("100")}, {})
