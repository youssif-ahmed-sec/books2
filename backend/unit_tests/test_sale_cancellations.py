from uuid import uuid4

import pytest

from api.v1.sale_cancellations import CancellationInput, SettlementInput


def test_direct_cancellation_rejects_nonfinite_amounts():
    with pytest.raises(ValueError):
        CancellationInput(request_id=uuid4(), order_id=uuid4(), confirmed_refund="NaN")


def test_settlement_rejects_invalid_amounts():
    with pytest.raises(ValueError):
        SettlementInput(confirmed_refund="NaN", refund_confirmed=True)
