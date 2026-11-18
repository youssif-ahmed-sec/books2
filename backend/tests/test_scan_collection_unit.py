"""Fast checks for the non-financial cashier confirmation."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
from fastapi import HTTPException
from api.v1.orders import collect_order_by_scan
from schemas.payment import OrderScanCollectCreate

class Result:
    def __init__(self, value): self.value = value
    def scalar_one_or_none(self): return self.value

class ScanCollectionContract(unittest.IsolatedAsyncioTestCase):
    async def test_marker_only_and_repeat_is_idempotent(self):
        order = SimpleNamespace(id=uuid4(), public_number=42, customer_id=None, status="Delivered",
                                cashier_collected=False, cashier_expected_amount=30, cashier_collected_by_id=None, cashier_collected_at=None)
        added = []
        db = SimpleNamespace(execute=AsyncMock(return_value=Result(order)), commit=AsyncMock(), add=added.append)
        user = SimpleNamespace(id=uuid4())
        payload = OrderScanCollectCreate(request_id=uuid4(), query="42")
        first = await collect_order_by_scan(payload, db, user)
        again = await collect_order_by_scan(payload, db, user)
        self.assertFalse(first.already_collected)
        self.assertEqual(first.confirmed_amount, 30)
        self.assertTrue(again.already_collected)
        self.assertTrue(order.cashier_collected)
        self.assertEqual(order.cashier_collected_by_id, user.id)
        self.assertIsNotNone(order.cashier_collected_at)
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0].action, "CONFIRM_CASHIER_COLLECTION")
        db.commit.assert_awaited_once()

    async def test_legacy_or_cancelled_never_marks(self):
        for status, marker in [("Delivered", None), ("Cancelled", False), ("Returned", False)]:
            order = SimpleNamespace(id=uuid4(), status=status, cashier_collected=marker)
            db = SimpleNamespace(execute=AsyncMock(return_value=Result(order)), commit=AsyncMock())
            with self.assertRaises(HTTPException) as caught:
                await collect_order_by_scan(OrderScanCollectCreate(request_id=uuid4(), query="42"), db, SimpleNamespace(id=uuid4()))
            self.assertEqual(caught.exception.status_code, 400)
            self.assertEqual(order.cashier_collected, marker)
            db.commit.assert_not_awaited()

if __name__ == "__main__": unittest.main()
