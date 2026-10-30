"""Exercise a correction on the confirmed test database with all writes rolled back."""
import asyncio
from decimal import Decimal
from uuid import uuid4

from verify_correction_migrations import engine, migrate
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from models.user import User, RoleEnum
from models.customer import Customer
from models.inventory import Warehouse, InventoryBalance
from models.product import Product, ProductUnit, ProductPrice
from models.financial import CashShift, Payment
from models.order import Order
from models.returns import SalesReturn
from schemas.order import OrderCreate
from services.order_service import OrderService
from services.sale_correction_requests import CorrectionProposal, create_correction_request, review_correction_request
from services.sale_correction_execution import preview_correction_settlement, apply_correction_settlement
from api.v1.customer_accounts import customer_statement


async def main():
    cashier_id, manager_id, customer_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    marker = uuid4().hex[:12]
    # Avoid consuming PostgreSQL sequences, which cannot be rolled back.
    numbers = iter(range(1000000000000 + int(marker, 16) * 10, 1000000000000 + int(marker, 16) * 10 + 10))
    def assign_number(_mapper, _connection, target):
        if target.public_number is None:
            target.public_number = next(numbers)
    event.listen(Order, "before_insert", assign_number)
    event.listen(SalesReturn, "before_insert", assign_number)
    async with engine.connect() as connection:
        revision = (await connection.execute(text("select version_num from alembic_version"))).scalar_one()
        assert revision == "a17e6c92d435"
        assert (await connection.execute(text("select to_regclass('public.sale_corrections')"))).scalar_one() is None
        await connection.rollback()
        outer = await connection.begin()
        try:
            await connection.run_sync(migrate)
            async with AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint") as db:
                cashier = User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, username=f"qa_cash_{marker}", is_active=True, is_deleted=False)
                manager = User(id=manager_id, role=RoleEnum.ADMIN, username=f"qa_mgr_{marker}", is_active=True, is_deleted=False)
                db.add_all([cashier, manager, Customer(id=customer_id, name="Test", credit_limit=500),
                    Warehouse(id=warehouse_id, name=f"QA {marker}"), Product(id=product_id, sku=f"QA-{marker}", name_en="QA", name_ar="اختبار", base_unit="Piece", cost=10)])
                await db.flush()
                db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
                await db.commit()
                sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
                    customer_id=customer_id, payment_method="Deferred Payment", amount_received=20, received_method="Cash",
                    expected_collection_method="Cash", next_due_date="2099-01-01",
                    items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}]), cashier_id)
                proposal = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, customer_id=customer_id,
                    payment_method="Deferred Payment", amount_received=30, received_method="Cash", expected_collection_method="Cash",
                    next_due_date="2099-01-01", items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2,
                        "price_level": "Retail", "original_item_id": sale["items"][0]["id"]}])
                request = await create_correction_request(db, sale["id"], proposal, cashier)
                await review_correction_request(db, request.id, manager)
                await db.commit()
                quote = await preview_correction_settlement(db, request.id, cashier)
                assert Decimal(quote["old_debt"]) == 40 and Decimal(quote["new_debt"]) == 30
                assert quote["adjustments"] == [{"kind": "SALE", "method": "Cash", "amount": "10.00"}]
                applied = await apply_correction_settlement(db, request.id, cashier, confirmed=True, fingerprint=quote["fingerprint"])
                await db.commit()
                assert (await apply_correction_settlement(db, request.id, cashier, confirmed=True, fingerprint=quote["fingerprint"])).corrected_order_id == applied.corrected_order_id
                assert (await db.execute(select(InventoryBalance.current_stock).where(InventoryBalance.warehouse_id == warehouse_id))).scalar_one() == 8
                assert (await db.execute(select(Customer.balance).where(Customer.id == customer_id))).scalar_one() == 30
                assert (await db.execute(select(Payment).where(Payment.user_id == cashier_id))).scalars().all().__len__() == 2
                statement = await customer_statement(customer_id, db, manager)
                assert statement["opening_balance"] == 0 and statement["closing_balance"] == 30
                print("PostgreSQL deferred correction, settlement, stock, statement and retry: pass", flush=True)
            assert outer.is_active
        finally:
            if outer.is_active:
                await outer.rollback()
        assert (await connection.execute(select(User.id).where(User.id == cashier_id))).scalar_one_or_none() is None
        assert (await connection.execute(text("select to_regclass('public.sale_corrections')"))).scalar_one() is None
        print("PostgreSQL test data and migrations rolled back", flush=True)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
