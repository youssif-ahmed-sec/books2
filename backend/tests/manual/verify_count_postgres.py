"""Test count approvals on the identified test DB, rolling all test records back."""
import asyncio
from uuid import uuid4
from verify_correction_migrations import engine
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from core.dependencies import get_current_user
from database import get_db
from main import app
from models.user import User, RoleEnum
from models.inventory import Warehouse, InventoryBalance, InventoryTransaction
from models.product import Product


async def main():
    controller_id, admin_id, warehouse_id, product_id = [uuid4() for _ in range(4)]
    marker = uuid4().hex[:12]
    async with engine.connect() as connection:
        assert (await connection.execute(text("select version_num from alembic_version"))).scalar_one() == "a17e6c92d435"
        await connection.rollback()
        outer = await connection.begin()
        try:
            def session():
                return AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
            async with session() as db:
                db.add_all([User(id=controller_id, username=f"qa_count_{marker}", role=RoleEnum.INVENTORY_CONTROLLER, is_active=True),
                    User(id=admin_id, username=f"qa_admin_{marker}", role=RoleEnum.ADMIN, is_active=True),
                    Warehouse(id=warehouse_id, name=f"QA {marker}"), Product(id=product_id, sku=f"QA-{marker}",
                        name_en="QA", name_ar="اختبار", base_unit="Piece", cost=12)])
                await db.flush()
                db.add(InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10))
                await db.commit()
            actor = {"id": controller_id, "role": RoleEnum.INVENTORY_CONTROLLER}
            async def isolated_db():
                async with session() as db:
                    yield db
            app.dependency_overrides[get_db] = isolated_db
            app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"], is_active=True)
            body = {"request_id": str(uuid4()), "warehouse_id": str(warehouse_id), "lines": [{"product_id": str(product_id),
                "expected_quantity": "10", "observed_quantity": "12", "reason": "تصحيح الكمية"}]}
            try:
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                    response = await client.post("/api/v1/inventory/count-sessions", json=body)
                    assert response.status_code == 200, (response.status_code, response.text[:300])
                    count_id = response.json()["items"][0]["id"]
                    assert response.json()["items"][0]["status"] == "PENDING"
                    assert (await connection.execute(select(InventoryBalance.current_stock).where(InventoryBalance.product_id == product_id))).scalar_one() == 10
                    assert (await client.post(f"/api/v1/inventory/counts/{count_id}/approve")).status_code == 403
                    actor.update(id=admin_id, role=RoleEnum.ADMIN)
                    assert (await client.post(f"/api/v1/inventory/counts/{count_id}/approve")).status_code == 200
                    assert (await client.post(f"/api/v1/inventory/counts/{count_id}/approve")).status_code == 200
                    assert (await connection.execute(select(InventoryBalance.current_stock).where(InventoryBalance.product_id == product_id))).scalar_one() == 12
                    assert len((await connection.execute(select(InventoryTransaction.id).where(InventoryTransaction.product_id == product_id))).all()) == 1
                    stale = {**body, "request_id": str(uuid4())}
                    assert (await client.post("/api/v1/inventory/count-sessions", json=stale)).status_code == 409
                    direct = {**stale, "request_id": str(uuid4()), "lines": [{**body["lines"][0], "expected_quantity": "12", "observed_quantity": "9"}]}
                    result = await client.post("/api/v1/inventory/count-sessions", json=direct)
                    assert result.status_code == 200 and result.json()["items"][0]["status"] == "APPROVED"
                    assert (await connection.execute(select(InventoryBalance.current_stock).where(InventoryBalance.product_id == product_id))).scalar_one() == 9
                    print("PostgreSQL count approval, retry, stale stock and direct admin: pass", flush=True)
            finally:
                app.dependency_overrides.pop(get_db, None)
                app.dependency_overrides.pop(get_current_user, None)
            assert outer.is_active
        finally:
            if outer.is_active:
                await outer.rollback()
        assert (await connection.execute(select(User.id).where(User.id == controller_id))).scalar_one_or_none() is None
        print("PostgreSQL test records rolled back", flush=True)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
