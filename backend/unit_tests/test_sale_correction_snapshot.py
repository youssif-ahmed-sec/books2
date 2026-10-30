from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from services.sale_correction_snapshot import _serialize, snapshot_fingerprint


def test_snapshot_normalizes_equivalent_timestamps_and_dictionary_order():
    instant = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    same_in_cairo = instant.astimezone(timezone(timedelta(hours=2)))
    assert _serialize(instant) == _serialize(same_in_cairo)
    assert snapshot_fingerprint({"a": 1, "b": 2}) == snapshot_fingerprint({"b": 2, "a": 1})


@pytest.mark.parametrize("invalid", [Decimal("NaN"), Decimal("Infinity"), float("nan"), float("inf")])
def test_snapshot_rejects_nonfinite_numbers(invalid):
    with pytest.raises((ValueError, TypeError)):
        _serialize(invalid)
