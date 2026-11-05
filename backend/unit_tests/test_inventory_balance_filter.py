from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.v1.inventory import get_inventory_balances


@pytest.mark.asyncio
async def test_product_filter_keeps_all_warehouses_and_unfiltered_contract():
    engine = create_async_engine("sqlite+aiosqlite://")
    product, other, active, inactive = (uuid4() for _ in range(4))
    async with engine.begin() as conn:
        await conn.execute(text("CREATE TABLE products (id CHAR(32), name_ar TEXT)"))
        await conn.execute(text("CREATE TABLE warehouses (id CHAR(32), name TEXT, is_active BOOLEAN)"))
        await conn.execute(text("CREATE TABLE inventory_balances (id CHAR(32), product_id CHAR(32), warehouse_id CHAR(32), current_stock NUMERIC, updated_at DATETIME)"))
        await conn.execute(text("INSERT INTO products VALUES (:id, :name)"), [{"id": product.hex, "name": "one"}, {"id": other.hex, "name": "two"}])
        await conn.execute(text("INSERT INTO warehouses VALUES (:id, :name, :active)"), [{"id": active.hex, "name": "active", "active": True}, {"id": inactive.hex, "name": "inactive", "active": False}])
        await conn.execute(text("INSERT INTO inventory_balances VALUES (:id, :product, :warehouse, 3, NULL)"), [
            {"id": uuid4().hex, "product": p.hex, "warehouse": w.hex}
            for p, w in ((product, active), (product, inactive), (other, active))
        ])
    async with async_sessionmaker(engine)() as db:
        user = SimpleNamespace()
        filtered = await get_inventory_balances(None, db, user, product)
        all_rows = await get_inventory_balances(None, db, user)
        one_warehouse = await get_inventory_balances(active, db, user, product)
    await engine.dispose()
    assert {row["warehouse_id"] for row in filtered} == {active, inactive}
    assert len(all_rows) == 3
    assert len(one_warehouse) == 1 and one_warehouse[0]["product_id"] == product
