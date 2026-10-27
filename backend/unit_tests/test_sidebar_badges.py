from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.v1.notifications import get_badge_counts
from models.user import RoleEnum


@pytest.mark.asyncio
async def test_badges_match_default_lists_and_user_scope():
    engine = create_async_engine("sqlite+aiosqlite://")
    owner, other = uuid4(), uuid4()
    async with engine.begin() as conn:
        await conn.execute(text("CREATE TABLE product_approvals (id TEXT PRIMARY KEY, requested_by TEXT, status TEXT)"))
        await conn.execute(text("CREATE TABLE purchase_documents (id TEXT PRIMARY KEY, requested_by TEXT, status TEXT)"))
        for table, rows in (
            ("product_approvals", [(owner, "PENDING"), (owner, "APPROVED"), (other, "REJECTED")]),
            ("purchase_documents", [(owner, "REQUESTED"), (owner, "APPROVED"),
                                    (owner, "RECEIVED"), (other, "ORDERED")]),
        ):
            for requester, status in rows:
                await conn.execute(text(f"INSERT INTO {table} (id, requested_by, status) VALUES (:id, :owner, :status)"),
                                   {"id": uuid4().hex, "owner": requester.hex, "status": status})
    async with async_sessionmaker(engine)() as db:
        admin = await get_badge_counts(db, SimpleNamespace(id=uuid4(), role=RoleEnum.ADMIN))
        controller = await get_badge_counts(db, SimpleNamespace(id=owner, role=RoleEnum.INVENTORY_CONTROLLER))
        cashier = await get_badge_counts(db, SimpleNamespace(id=other, role=RoleEnum.CASHIER_ORDERS))
    await engine.dispose()
    assert admin == {"product_approvals": 3, "purchases": 3}
    assert controller == {"product_approvals": 2, "purchases": 2}
    assert cashier == {"product_approvals": 0, "purchases": 0}
