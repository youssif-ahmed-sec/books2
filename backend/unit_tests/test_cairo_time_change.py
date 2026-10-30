from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from services.analytics_service import _elapsed_cutoff
from api.v1.reports import _report_bounds
from fastapi import HTTPException


@pytest.mark.parametrize("instant, expected", [
    ("2026-04-23T21:59:59+00:00", "2026-04-23T23:59:59+02:00"),
    ("2026-04-23T22:00:00+00:00", "2026-04-24T01:00:00+03:00"),
    ("2026-10-29T20:59:59+00:00", "2026-10-29T23:59:59+03:00"),
    ("2026-10-29T21:00:00+00:00", "2026-10-29T23:00:00+02:00"),
])
def test_cairo_clock_switches_automatically(instant, expected):
    assert datetime.fromisoformat(instant).astimezone(ZoneInfo("Africa/Cairo")).isoformat() == expected


@pytest.mark.parametrize("instant", ["2026-04-23T22:30:00+00:00", "2026-10-29T22:30:00+00:00"])
def test_delayed_order_cutoff_measures_two_real_hours_through_clock_change(instant):
    now = datetime.fromisoformat(instant).astimezone(ZoneInfo("Africa/Cairo"))
    cutoff = _elapsed_cutoff(now, timedelta(hours=2))
    assert now.astimezone(timezone.utc) - cutoff == timedelta(hours=2)


@pytest.mark.parametrize("day, hours", [(date(2026, 4, 24), 23), (date(2026, 10, 29), 25), (date(2026, 10, 30), 24)])
def test_cairo_report_days_have_correct_utc_boundaries(day, hours):
    start, end = _report_bounds(None, None, day, day)
    assert end.astimezone(timezone.utc) - start.astimezone(timezone.utc) == timedelta(hours=hours)


def test_report_rejects_mixed_or_reversed_date_ranges():
    with pytest.raises(HTTPException):
        _report_bounds(datetime.now(timezone.utc), None, date(2026, 1, 1), None)
    with pytest.raises(HTTPException):
        _report_bounds(None, None, date(2026, 2, 1), date(2026, 1, 1))
