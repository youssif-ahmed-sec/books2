"""Calculate a correction proposal using server-resolved line prices."""
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from schemas.order import OrderCreate
from services.sale_correction_pricing import PricedCorrectionLine


CENT = Decimal("0.01")
MAX_TOTAL = Decimal("9999999999.99")


@dataclass(frozen=True)
class CorrectionQuote:
    subtotal: Decimal
    discount: Decimal
    shipping: Decimal
    wallet_fee: Decimal
    total: Decimal
    collected: Decimal
    deferred_remaining: Decimal

    def as_json(self) -> dict[str, str]:
        return {key: str(value) for key, value in vars(self).items()}


def quote_correction(proposal: OrderCreate, lines: list[PricedCorrectionLine]) -> CorrectionQuote:
    if not lines or len(lines) != len(proposal.items):
        raise ValueError("The priced items do not match the proposal.")
    for item, line in zip(proposal.items, lines):
        if (line.product_id != item.product_id or line.unit_id != item.unit_id
                or line.price_level != item.price_level.value or line.quantity != item.quantity
                or line.original_item_id != getattr(item, "original_item_id", None)):
            raise ValueError("The priced items do not match the proposal.")
    if any(not line.unit_price.is_finite() or line.unit_price <= 0 or line.unit_price > MAX_TOTAL
           or line.unit_price * line.quantity > MAX_TOTAL for line in lines):
        raise ValueError("A corrected line exceeds the allowed price or amount.")
    subtotal = sum((line.unit_price * line.quantity for line in lines), Decimal("0"))
    discount = Decimal(str(proposal.discount_amount))
    if not subtotal.is_finite() or subtotal <= 0 or subtotal > MAX_TOTAL or discount > subtotal:
        raise ValueError("Discount cannot exceed the order subtotal.")
    if proposal.discount_percent is not None:
        expected_discount = (subtotal * proposal.discount_percent / Decimal("100")).quantize(CENT, rounding=ROUND_HALF_UP)
        if discount != expected_discount:
            raise ValueError("Discount percentage does not match the order subtotal.")
    shipping = Decimal(str(proposal.shipping_cost))
    base = subtotal - discount + shipping
    wallet_base = Decimal("0")
    if proposal.payment_method == "Wallet":
        wallet_base = base
    elif proposal.payment_method == "Deferred Payment" and proposal.received_method == "Wallet":
        wallet_base = proposal.amount_received or Decimal("0")
    fee = (wallet_base / Decimal("100")).quantize(CENT, rounding=ROUND_HALF_UP)
    total = (base + fee).quantize(CENT, rounding=ROUND_HALF_UP)
    if total < 0 or total > MAX_TOTAL:
        raise ValueError("The corrected total is outside the allowed range.")
    if proposal.expected_total is not None and proposal.expected_total != total:
        raise ValueError("The corrected total changed; review it again.")
    if proposal.payment_method == "Deferred Payment":
        paid_base = proposal.amount_received or Decimal("0")
        if paid_base > base:
            raise ValueError("Received amount cannot exceed the corrected total.")
        collected = paid_base + (fee if proposal.received_method == "Wallet" else Decimal("0"))
        remaining = total - collected
        if remaining > 0 and (proposal.expected_collection_method is None or proposal.next_due_date is None):
            raise ValueError("Choose the collection method and due date for the remaining balance.")
        if remaining == 0 and (proposal.expected_collection_method is not None or proposal.next_due_date is not None):
            raise ValueError("No remaining balance needs a collection method or due date.")
    else:
        collected = total
        remaining = Decimal("0")
    return CorrectionQuote(subtotal.quantize(CENT, rounding=ROUND_HALF_UP), discount.quantize(CENT),
                           shipping.quantize(CENT), fee, total, collected.quantize(CENT), remaining.quantize(CENT))
