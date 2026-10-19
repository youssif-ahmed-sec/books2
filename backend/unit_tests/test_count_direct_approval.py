"""Role-specific physical count behavior without touching a database."""

import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from models.inventory import InventoryBalance, InventoryCount
from models.user import RoleEnum, User
from schemas.inventory import CountSessionLine
from services import count_service


class FakeResult:
    def scalar_one(self):
        return Decimal("5")


class FakeSession:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        pass

    async def execute(self, _statement):
        return FakeResult()

    async def commit(self):
        self.commits += 1


class DirectCountApprovalTests(unittest.IsolatedAsyncioTestCase):
    async def check_role(self, role, expected_status, expected_stock, expected_notification):
        product_id, warehouse_id, user_id = uuid4(), uuid4(), uuid4()
        product = SimpleNamespace(id=product_id, name_ar="منتج", cost=Decimal("12"))
        balance = InventoryBalance(product_id=product_id, warehouse_id=warehouse_id,
                                   current_stock=Decimal("5"))
        movements = []

        def record_movement(_db, row, quantity, actor_id, *_args, **_kwargs):
            row.current_stock += quantity
            movements.append((quantity, actor_id))

        with (patch.object(count_service, "_locked_count_context", new_callable=AsyncMock,
                           return_value=({product_id: product}, {product_id: balance})),
              patch.object(count_service, "notify_roles", new_callable=AsyncMock) as notify_roles,
              patch.object(count_service, "notify_low_stock_crossing", new_callable=AsyncMock),
              patch.object(count_service.InventoryService, "record_movement", record_movement)):
            db = FakeSession()
            user = User(id=user_id, role=role)
            line = CountSessionLine(product_id=product_id, expected_quantity=5,
                                    observed_quantity=7, reason="تلف وحدة")
            counts = await count_service.submit_counts(db, user, warehouse_id, [line],
                                                       session_id=uuid4(), fingerprint="a" * 64)

        self.assertEqual(len(counts), 1)
        self.assertEqual(counts[0].status, expected_status)
        self.assertEqual(balance.current_stock, expected_stock)
        self.assertEqual(bool(movements), role == RoleEnum.ADMIN)
        self.assertEqual(bool(counts[0].reviewed_by), role == RoleEnum.ADMIN)
        self.assertEqual(notify_roles.await_count, int(expected_notification))
        self.assertEqual(db.commits, 1)
        self.assertEqual(len([item for item in db.added if isinstance(item, InventoryCount)]), 1)

    async def test_admin_difference_updates_stock_without_approval(self):
        await self.check_role(RoleEnum.ADMIN, "APPROVED", Decimal("7"), False)

    async def test_controller_difference_waits_for_approval(self):
        await self.check_role(RoleEnum.INVENTORY_CONTROLLER, "PENDING", Decimal("5"), True)

    async def test_admin_stale_expected_stock_is_rejected(self):
        product_id, warehouse_id = uuid4(), uuid4()
        product = SimpleNamespace(id=product_id, name_ar="منتج", cost=Decimal("12"))
        balance = InventoryBalance(product_id=product_id, warehouse_id=warehouse_id,
                                   current_stock=Decimal("5"))
        with patch.object(count_service, "_locked_count_context", new_callable=AsyncMock,
                          return_value=({product_id: product}, {product_id: balance})):
            db = FakeSession()
            line = CountSessionLine(product_id=product_id, expected_quantity=4,
                                    observed_quantity=7, reason="تلف وحدة")
            with self.assertRaises(HTTPException) as error:
                await count_service.submit_counts(db, User(id=uuid4(), role=RoleEnum.ADMIN),
                                                  warehouse_id, [line], session_id=uuid4(),
                                                  fingerprint="b" * 64)

        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(balance.current_stock, Decimal("5"))
        self.assertEqual(db.commits, 0)


if __name__ == "__main__":
    unittest.main()
