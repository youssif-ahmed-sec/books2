"""Verify Cairo day filtering on isolated PostgreSQL data and roll it all back."""
import asyncio
from datetime import date, datetime, timezone
from uuid import uuid4
from verify_correction_migrations import engine
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from api.v1.reports import get_inventory_report
from models.user import User, RoleEnum
from models.product import Product
from models.inventory import Warehouse, InventoryTransaction, TransactionTypeEnum


async def main():
    user_id, product_id, warehouse_id = [uuid4() for _ in range(3)]
    transaction_ids = [uuid4() for _ in range(4)]
    marker = uuid4().hex[:12]
    async with engine.connect() as connection:
        assert (await connection.execute(text("select version_num from alembic_version"))).scalar_one() == "a17e6c92d435"
        await connection.rollback()
        outer = await connection.begin()
        try:
            async with AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint") as db:
                user = User(id=user_id, username=f"qa_time_{marker}", role=RoleEnum.ADMIN, is_active=True)
                db.add_all([user, Warehouse(id=warehouse_id, name=f"QA {marker}"),
                    Product(id=product_id, sku=f"QA-TIME-{marker}", name_en="QA", name_ar="اختبار", base_unit="Piece")])
                await db.flush()
                for id, instant in zip(transaction_ids, ("2026-10-28T20:59:59+00:00", "2026-10-29T20:30:00+00:00",
                                                           "2026-10-29T21:30:00+00:00", "2026-10-29T22:00:00+00:00")):
                    db.add(InventoryTransaction(id=id, user_id=user_id, product_id=product_id, warehouse_id=warehouse_id,
                        transaction_type=TransactionTypeEnum.COUNTING, quantity_changed=1,
                        created_at=datetime.fromisoformat(instant).astimezone(timezone.utc)))
                await db.commit()
                report = await get_inventory_report(start_day=date(2026, 10, 29), end_day=date(2026, 10, 29),
                    db=db, current_user=user, limit=100, offset=0)
                found = {row["id"] for row in report["data"]} & set(transaction_ids)
                assert found == set(transaction_ids[1:3]), found
                print("PostgreSQL inventory report includes both repeated hours and excludes adjacent days", flush=True)
            assert outer.is_active
        finally:
            if outer.is_active:
                await outer.rollback()
        assert (await connection.execute(select(User.id).where(User.id == user_id))).scalar_one_or_none() is None
        print("Test records rolled back", flush=True)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
