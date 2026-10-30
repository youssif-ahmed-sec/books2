"""Pure payment-delta calculation for a proposed sale correction.

This does not authorize, execute, or persist a correction. Callers must supply
verified collected amounts, separately handle debt and fees, and confirm the
physical settlement before creating payment entries.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Mapping


COLLECTED_METHODS = frozenset({"Cash", "Wallet", "Vodafone Cash", "Bank Transfer", "Instapay", "Credit Card"})
CENT = Decimal("0.01")
MAX_AMOUNT = Decimal("9999999999.99")


@dataclass(frozen=True)
class PaymentDelta:
    method: str
    kind: str
    amount: Decimal


def _checked_amount(value: Decimal) -> Decimal:
    if not isinstance(value, Decimal) or not value.is_finite() or value < 0 or value > MAX_AMOUNT:
        raise ValueError("Collected amounts must be finite non-negative Decimal values within the payment limit.")
    try:
        rounded = value.quantize(CENT)
    except InvalidOperation as exc:
        raise ValueError("Invalid collected amount.") from exc
    if rounded != value:
        raise ValueError("Collected amounts cannot contain fractions of a cent.")
    return rounded


def payment_deltas(previous: Mapping[str, Decimal], proposed: Mapping[str, Decimal]) -> list[PaymentDelta]:
    """Return positive refund/collection entries per actual payment method.

    The inputs are collected amounts, not invoice totals or deferred balances.
    Their provenance and the calculation of fees/debt are the caller's responsibility.
    """
    if (set(previous) | set(proposed)) - COLLECTED_METHODS:
        raise ValueError("Unsupported collected payment method.")
    result = []
    for method in sorted(set(previous) | set(proposed)):
        old = _checked_amount(previous.get(method, Decimal("0")))
        new = _checked_amount(proposed.get(method, Decimal("0")))
        difference = new - old
        if difference:
            result.append(PaymentDelta(method, "SALE" if difference > 0 else "REFUND", abs(difference)))
    # Reversals precede collections even when the method names sort otherwise.
    return sorted(result, key=lambda entry: (entry.kind != "REFUND", entry.method))
