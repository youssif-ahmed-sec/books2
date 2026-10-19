import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from api.v1.notifications import list_notifications
from api.v1.cash_register import CloseShift, finish_shift
from models.user import RoleEnum
from services.gmail_smtp import gmail_configured, send_gmail_message
from services.notification_service import notify_low_stock_crossing
from services.shift_email_service import deliver_shift_email, prepare_shift_email


class Result:
    def __init__(self, value):
        self.value = value

    def scalars(self):
        return self

    def all(self):
        return self.value

    def scalar_one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


class NotificationDb:
    def __init__(self, rows, unread):
        self.results = [Result(rows), Result(unread)]
        self.queries = []

    async def execute(self, query):
        self.queries.append(query)
        return self.results.pop(0)


def test_notification_pages_keep_unread_count_and_expose_more():
    now = datetime.now(timezone.utc)
    rows = [SimpleNamespace(id=uuid4(), kind="stock_received", title="title",
                            message="message", href="/purchases", created_at=now,
                            read_at=None) for _ in range(3)]
    db = NotificationDb(rows, 7)
    result = asyncio.run(list_notifications(limit=2, before=None, before_id=None,
                                            db=db, user=SimpleNamespace(id=uuid4())))
    assert len(result["items"]) == 2
    assert result["has_more"] is True
    assert result["unread_count"] == 7
    assert "notifications.user_id" in str(db.queries[0])


def test_notification_cursor_requires_both_parts():
    with pytest.raises(HTTPException) as raised:
        asyncio.run(list_notifications(limit=30, before=datetime.now(timezone.utc),
                                       before_id=None, db=NotificationDb([], 0),
                                       user=SimpleNamespace(id=uuid4())))
    assert raised.value.status_code == 422


def test_low_stock_crossing_creates_notifications_for_admin_and_inventory():
    class Db:
        def __init__(self):
            self.added = []

        async def execute(self, query):
            return Result([uuid4(), uuid4()])

        def add_all(self, rows):
            self.added.extend(rows)

    db = Db()
    product = SimpleNamespace(name_ar="كتاب", base_unit="قطعة", min_stock_level=5)
    asyncio.run(notify_low_stock_crossing(db, product, Decimal("6"), Decimal("4")))
    assert len(db.added) == 2
    assert all(notice.kind == "low_stock" for notice in db.added)
    db.added.clear()
    asyncio.run(notify_low_stock_crossing(db, product, Decimal("4"), Decimal("3")))
    assert not db.added


def test_gmail_uses_app_password_without_network(monkeypatch):
    sent = []

    class FakeSmtp:
        def __init__(self, host, port, timeout, context):
            assert (host, port, timeout) == ("smtp.gmail.com", 465, 10)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def login(self, address, password):
            sent.append((address, password))

        def send_message(self, message):
            sent.append((message["To"], message["Subject"]))

    monkeypatch.setenv("GMAIL_ADDRESS", "sender@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop")
    monkeypatch.setattr("services.gmail_smtp.smtplib.SMTP_SSL", FakeSmtp)
    assert gmail_configured()
    asyncio.run(send_gmail_message("sender@gmail.com", "اختبار", "رسالة"))
    assert sent == [("sender@gmail.com", "abcdefghijklmnop"), ("sender@gmail.com", "اختبار")]


def test_gmail_without_credentials_stays_disabled(monkeypatch):
    monkeypatch.delenv("GMAIL_ADDRESS", raising=False)
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)
    assert not gmail_configured()
    with pytest.raises(ValueError):
        asyncio.run(send_gmail_message("any@example.com", "subject", "body"))


def test_shift_summary_snapshots_cash_breakdown_and_difference():
    class ShiftDb:
        def __init__(self):
            self.results = [Result(SimpleNamespace(username="cashier1", email="cashier@example.com")),
                            Result([("SALE", 2, Decimal("120")), ("COLLECTION", 1, Decimal("30")),
                                    ("REFUND", 1, Decimal("10"))]),
                            Result([SimpleNamespace(amount=Decimal("-5"), reason="مصروف توصيل")])]
            self.added = []

        async def execute(self, query):
            return self.results.pop(0)

        def add(self, row):
            self.added.append(row)

    db = ShiftDb()
    now = datetime.now(timezone.utc)
    shift = SimpleNamespace(id=uuid4(), user_id=uuid4(), opened_at=now, closed_at=now,
                            opening_cash=Decimal("100"), expected_cash=Decimal("235"),
                            closing_cash=Decimal("230"))
    report = asyncio.run(prepare_shift_email(db, shift, "manager@example.com"))
    assert report in db.added
    assert report.recipient_email == "manager@example.com"
    assert "مبيعات نقدية: 120.00 ج.م (2 عملية)" in report.body
    assert "الفرق (المعدود - المتوقع): -5.00 ج.م" in report.body
    assert "مصروف توصيل" in report.body


def test_shift_email_failure_keeps_report_for_retry(monkeypatch):
    report = SimpleNamespace(shift_id=uuid4(), recipient_email="manager@example.com",
                             subject="summary", body="body", status="PENDING", attempts=0, sent_at=None)

    class Db:
        committed = False

        async def execute(self, query):
            return Result(report)

        async def commit(self):
            self.committed = True

    async def fail(*args):
        raise OSError("SMTP unavailable")

    monkeypatch.setattr("services.shift_email_service.send_gmail_message", fail)
    db = Db()
    assert asyncio.run(deliver_shift_email(db, report.shift_id)) == "FAILED"
    assert report.attempts == 1 and db.committed


def test_shift_closes_before_email_and_cashier_cannot_see_reconciliation(monkeypatch):
    events = []
    now = datetime.now(timezone.utc)
    shift = SimpleNamespace(id=uuid4(), user_id=uuid4(), status="OPEN", opening_cash=Decimal("10"),
                            expected_cash=None, closing_cash=None, opened_at=now, closed_at=None)

    class Db:
        async def execute(self, query):
            return Result(SimpleNamespace(email="manager@example.com"))

        def add(self, row):
            pass

        async def commit(self):
            events.append("commit")

    async def open_existing(*args):
        return shift

    async def expected(*args):
        return Decimal("35")

    async def prepare(*args):
        events.append("prepare")

    async def deliver(*args):
        events.append("deliver")
        return "SENT"

    monkeypatch.setattr("api.v1.cash_register.open_shift", open_existing)
    monkeypatch.setattr("api.v1.cash_register.expected_cash", expected)
    monkeypatch.setattr("api.v1.cash_register.prepare_shift_email", prepare)
    monkeypatch.setattr("api.v1.cash_register.deliver_shift_email", deliver)
    result = asyncio.run(finish_shift(CloseShift(closing_cash=Decimal("30")), Db(),
                                      SimpleNamespace(id=shift.user_id, role=RoleEnum.CASHIER_ORDERS)))
    assert events == ["prepare", "commit", "deliver"]
    assert result["status"] == "CLOSED"
    assert result["expected_cash"] is None
    assert result["difference"] is None
    assert "email_report_status" not in result
