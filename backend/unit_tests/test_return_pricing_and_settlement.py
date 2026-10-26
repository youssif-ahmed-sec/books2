import asyncio
from decimal import Decimal
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from models.order import OrderStatusEnum
from models.returns import SalesReturn
from services.analytics_service import COMPLETED
from services.return_service import ReturnService
from schemas.returns import SalesReturnCreate, SalesReturnResponse
from api.v1.returns import RETURNABLE_STATUSES


def test_return_uses_sale_snapshot_after_catalog_price_changes():
    sold_line = SimpleNamespace(
        unit_price=Decimal("30.00"), total_price=Decimal("60.00"),
        quantity_requested=Decimal("2"), current_catalog_price=Decimal("80.00"),
    )
    factor = Decimal("50") / Decimal("60")
    first = ReturnService._return_line_amount(sold_line, Decimal("1"), Decimal("0"), Decimal("0"), factor)
    last = ReturnService._return_line_amount(sold_line, Decimal("1"), Decimal("1"), first, factor)
    assert (first, last) == (Decimal("25.00"), Decimal("25.00"))


def test_unpaid_deferred_invoice_cannot_refund_cash_without_reconciling_debt():
    order = SimpleNamespace(payment_method="Deferred Payment", deferred_remaining=Decimal("60"), customer_id=uuid4())
    with pytest.raises(ValueError, match="customer debt"):
        ReturnService._settlement_method(order, SimpleNamespace(settlement_payment_method="Cash"))
    assert ReturnService._settlement_method(
        order, SimpleNamespace(settlement_payment_method="Deferred Payment"),
    ) == "Deferred Payment"
    order.deferred_remaining = Decimal("0")
    assert ReturnService._settlement_method(
        order, SimpleNamespace(settlement_payment_method="Cash"),
    ) == "Cash"
    with pytest.raises(ValueError, match="customer account"):
        ReturnService._settlement_method(
            SimpleNamespace(payment_method="Cash", deferred_remaining=None, customer_id=None),
            SimpleNamespace(settlement_payment_method="Deferred Payment"),
        )


def test_wallet_collection_and_exchange_are_counted():
    charge = Decimal("125.00")
    record = SalesReturn(payment_method="Wallet", charge_amount=charge)
    assert ReturnService._wallet_fee(charge, "Wallet") == Decimal("1.25")
    assert record.collection_amount == Decimal("126.25")
    assert OrderStatusEnum.EXCHANGE.value in COMPLETED

    record.id = uuid4()
    record.public_number = 100013
    record.order_id = uuid4()
    record.exchange_order_id = uuid4()
    record.warehouse_id = uuid4()
    record.user_id = uuid4()
    record.kind = "EXCHANGE"
    record.refund_amount = Decimal("0")
    record.returned_value = Decimal("25")
    record.replacement_value = Decimal("150")
    record.created_at = datetime.now(timezone.utc)
    response = SalesReturnResponse.model_validate(record)
    assert response.wallet_fee_amount == Decimal("1.25")
    assert response.collection_amount == Decimal("126.25")


def test_return_post_requires_explicit_confirmation_and_reviewed_amounts():
    fields = dict(order_id=uuid4(), warehouse_id=uuid4(), kind="REFUND",
                  lines=[{"order_item_id": uuid4(), "quantity": 1}], request_id=uuid4())
    draft = SalesReturnCreate(**fields)
    assert draft.settlement_confirmed is False
    with pytest.raises(ValueError, match="Confirm the settlement"):
        asyncio.run(ReturnService.process(None, draft, uuid4()))
    with pytest.raises(ValueError, match="Preview the refund"):
        asyncio.run(ReturnService.process(None, draft.model_copy(update={"settlement_confirmed": True}), uuid4()))
    assert OrderStatusEnum.EXCHANGE.value in RETURNABLE_STATUSES
