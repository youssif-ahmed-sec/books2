"""Exercise financial API journeys in one rollback-only transaction on nxdy test DB."""

import asyncio
import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from dotenv import dotenv_values


root = Path(__file__).resolve().parents[1]
backend = root / "backend"
settings = dotenv_values(backend / ".env")
target = urlsplit(settings.get("DATABASE_URL") or "")
if not (
    target.hostname == "aws-0-eu-west-1.pooler.supabase.com"
    and target.username == "postgres.nxdyxkvqiamjodmnetvs"
    and target.port == 6543
    and "htdudqglmohxikoiqbdq" not in (settings.get("DATABASE_URL") or "")
):
    raise RuntimeError("Refusing financial test outside the confirmed nxdy test database")
os.environ.update({key: value for key, value in settings.items() if value is not None})
os.environ["DATABASE_SSL_CA_CERT"] = str(backend / "certs" / "supabase-root-2021.crt")
os.environ["DATABASE_SSL_ALLOW_LEGACY_CA"] = "1"
sys.path.insert(0, str(backend))
os.chdir(backend)

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from core.dependencies import get_current_user  # noqa: E402
from database import engine, get_db  # noqa: E402
from main import app  # noqa: E402
from models.customer import Customer  # noqa: E402
from models.financial import Payment  # noqa: E402
from models.inventory import InventoryBalance, Warehouse  # noqa: E402
from models.order import Order  # noqa: E402
from models.product import Product, ProductPrice, ProductUnit, PriceLevelEnum  # noqa: E402
from models.returns import SalesReturn  # noqa: E402
from models.user import RoleEnum, User  # noqa: E402


def must(response, status: int):
    assert response.status_code == status, (response.request.method, response.request.url.path,
                                            response.status_code, response.text[:500])
    return response.json()


async def main():
    marker = uuid4().hex[:12]
    user_id, customer_id, warehouse_id, old_id, new_id, old_unit, new_unit = [uuid4() for _ in range(7)]
    async with engine.connect() as connection:
        identity = (await connection.execute(text("select current_database(), current_user"))).one()
        revision = (await connection.execute(text("select version_num from alembic_version"))).scalar_one()
        assert identity[0] == "postgres" and identity[1] in ("postgres", "postgres.nxdyxkvqiamjodmnetvs")
        print(f"test database verified; revision={revision}", flush=True)
        await connection.rollback()
        outer = await connection.begin()
        try:
            def session():
                return AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")

            async with session() as db:
                db.add_all([
                    User(id=user_id, role=RoleEnum.ADMIN, username=f"qa_{marker}"),
                    Customer(id=customer_id, name=f"QA {marker}", balance=0, credit_limit=1000),
                    Warehouse(id=warehouse_id, name=f"QA {marker}"),
                    Product(id=old_id, sku=f"QA-OLD-{marker}", name_en="QA old", name_ar=f"اختبار {marker} قديم",
                            base_unit="Piece", cost=12),
                    Product(id=new_id, sku=f"QA-NEW-{marker}", name_en="QA new", name_ar=f"اختبار {marker} جديد",
                            base_unit="Piece", cost=18),
                ])
                await db.flush()
                db.add_all([
                    ProductUnit(id=old_unit, product_id=old_id, unit_name="Piece", conversion_factor=1),
                    ProductUnit(id=new_unit, product_id=new_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=old_id, warehouse_id=warehouse_id, current_stock=5),
                    InventoryBalance(product_id=new_id, warehouse_id=warehouse_id, current_stock=5),
                ])
                await db.flush()
                db.add_all([
                    ProductPrice(product_id=old_id, unit_id=old_unit, price_level=PriceLevelEnum.RETAIL, price=30),
                    ProductPrice(product_id=new_id, unit_id=new_unit, price_level=PriceLevelEnum.RETAIL, price=40),
                ])
                await db.commit()

            actor = {"role": RoleEnum.ADMIN}

            async def isolated_db():
                async with session() as db:
                    yield db

            def test_user():
                return User(id=user_id, role=actor["role"], is_active=True, is_deleted=False)

            app.dependency_overrides[get_db] = isolated_db
            app.dependency_overrides[get_current_user] = test_user
            try:
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                    must(await client.post("/api/v1/cash-register/open", json={"opening_cash": 0}), 201)
                    baseline = must(await client.get("/api/v1/reports/financial-summary"), 200)

                    async def sale(method="Cash"):
                        data = {"request_id": str(uuid4()), "warehouse_id": str(warehouse_id),
                                "customer_id": str(customer_id), "payment_method": method,
                                "items": [{"product_id": str(old_id), "unit_id": str(old_unit), "quantity": 1}]}
                        if method == "Deferred Payment":
                            data.update(amount_received=0, expected_collection_method="Cash",
                                        next_due_date=(datetime.now().date() + timedelta(days=1)).isoformat())
                        return must(await client.post("/api/v1/orders", json=data), 201)

                    async def quote(payload):
                        return must(await client.post("/api/v1/returns/preview", json=payload), 200)

                    async def record(payload, preview):
                        data = {**payload, "settlement_confirmed": True,
                                "expected_refund_amount": preview["refund_amount"],
                                "expected_charge_amount": preview["charge_amount"]}
                        return must(await client.post("/api/v1/returns", json=data), 201)

                    # Cash sale, exchange, second-generation refund, and repriced catalog.
                    first = await sale()
                    async with session() as db:
                        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == old_id))).scalar_one()
                        price.price = 55
                        await db.commit()
                    exchange_payload = {
                        "request_id": str(uuid4()), "order_id": first["id"], "warehouse_id": str(warehouse_id),
                        "kind": "EXCHANGE", "lines": [{"order_item_id": first["items"][0]["id"], "quantity": 1}],
                        "replacements": [{"product_id": str(new_id), "unit_id": str(new_unit), "quantity": 1}],
                    }
                    preview = await quote(exchange_payload)
                    assert Decimal(preview["returned_value"]) == 30 and Decimal(preview["charge_amount"]) == 10
                    must(await client.post("/api/v1/returns", json=exchange_payload), 400)
                    must(await client.post("/api/v1/returns", json={**exchange_payload, "settlement_confirmed": True}), 400)
                    must(await client.post("/api/v1/returns", json={**exchange_payload, "settlement_confirmed": True,
                        "expected_refund_amount": 0, "expected_charge_amount": 9}), 400)
                    exchange = await record(exchange_payload, preview)
                    assert Decimal(exchange["charge_amount"]) == 10
                    again = await record(exchange_payload, preview)
                    assert again["id"] == exchange["id"]
                    exchange_id = exchange["exchange_order_id"]
                    exchange_order = must(await client.get(f"/api/v1/returns/eligibility/{exchange_id}"), 200)
                    assert Decimal(str(exchange_order["items"][0]["remaining_quantity"])) == 1
                    found = must(await client.get(f"/api/v1/returns/lookup/{exchange_id}"), 200)
                    assert found["id"] == exchange_id
                    refund_payload = {"request_id": str(uuid4()), "order_id": exchange_id,
                                      "warehouse_id": str(warehouse_id), "kind": "REFUND",
                                      "lines": [{"order_item_id": exchange_order["items"][0]["order_item_id"], "quantity": 1}]}
                    refund_quote = await quote(refund_payload)
                    assert Decimal(refund_quote["refund_amount"]) == 40
                    second_return = await record(refund_payload, refund_quote)
                    assert Decimal(second_return["refund_amount"]) == 40
                    second_receipt = must(await client.get(f"/api/v1/returns/{second_return['id']}/receipt"), 200)
                    assert Decimal(second_receipt["refund_amount"]) == 40
                    print("cash sale -> exchange -> replacement refund: pass", flush=True)

                    # Deferred replacement debt stays linked to the original invoice.
                    deferred = await sale("Deferred Payment")
                    deferred_payload = {"request_id": str(uuid4()), "order_id": deferred["id"],
                                        "warehouse_id": str(warehouse_id), "kind": "EXCHANGE",
                                        "settlement_payment_method": "Deferred Payment",
                                        "lines": [{"order_item_id": deferred["items"][0]["id"], "quantity": 1}],
                                        "replacements": [{"product_id": str(new_id), "unit_id": str(new_unit), "quantity": 1}]}
                    deferred_quote = await quote(deferred_payload)
                    deferred_exchange = await record(deferred_payload, deferred_quote)
                    exchange_number = (await connection.execute(select(Order.public_number).where(
                        Order.id == UUID(deferred_exchange["exchange_order_id"])))).scalar_one()
                    invoice_rows = must(await client.get("/api/v1/orders/invoices", params={
                        "search": str(exchange_number), "payment_status": "due"}), 200)
                    assert any(row["id"] == deferred_exchange["exchange_order_id"] and row["payment_status"] == "due"
                               for row in invoice_rows)
                    original_due = (await connection.execute(select(Order.deferred_remaining).where(
                        Order.id == UUID(deferred["id"])))).scalar_one()
                    assert Decimal(original_due) == 40
                    linked = must(await client.get(f"/api/v1/returns/eligibility/{deferred_exchange['exchange_order_id']}"), 200)
                    deferred_refund = {"request_id": str(uuid4()), "order_id": deferred_exchange["exchange_order_id"],
                                       "warehouse_id": str(warehouse_id), "kind": "REFUND",
                                       "settlement_payment_method": "Deferred Payment",
                                       "lines": [{"order_item_id": linked["items"][0]["order_item_id"], "quantity": 1}]}
                    deferred_refund_quote = await quote(deferred_refund)
                    await record(deferred_refund, deferred_refund_quote)
                    final_due = (await connection.execute(select(Order.deferred_remaining).where(
                        Order.id == UUID(deferred["id"])))).scalar_one()
                    customer_balance = (await connection.execute(select(Customer.balance).where(
                        Customer.id == customer_id))).scalar_one()
                    assert Decimal(final_due) == 0 and Decimal(customer_balance) == 0
                    print("deferred sale -> exchange -> replacement refund -> debt zero: pass", flush=True)

                    # Wallet fee is collected on the exchange difference, but never refunded.
                    async with session() as db:
                        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == old_id))).scalar_one()
                        price.price = 30
                        await db.commit()
                    wallet_sale = await sale()
                    wallet_exchange_payload = {"request_id": str(uuid4()), "order_id": wallet_sale["id"],
                                               "warehouse_id": str(warehouse_id), "kind": "EXCHANGE",
                                               "settlement_payment_method": "Wallet",
                                               "lines": [{"order_item_id": wallet_sale["items"][0]["id"], "quantity": 1}],
                                               "replacements": [{"product_id": str(new_id), "unit_id": str(new_unit), "quantity": 1}]}
                    wallet_quote = await quote(wallet_exchange_payload)
                    assert Decimal(wallet_quote["charge_amount"]) == 10
                    assert Decimal(wallet_quote["wallet_fee_amount"]) == Decimal("0.10")
                    assert Decimal(wallet_quote["collection_amount"]) == Decimal("10.10")
                    wallet_exchange = await record(wallet_exchange_payload, wallet_quote)
                    receipt = must(await client.get(f"/api/v1/returns/{wallet_exchange['id']}/receipt"), 200)
                    assert Decimal(receipt["collection_amount"]) == Decimal("10.10")
                    wallet_eligibility = must(await client.get(
                        f"/api/v1/returns/eligibility/{wallet_exchange['exchange_order_id']}"), 200)
                    wallet_refund_payload = {"request_id": str(uuid4()), "order_id": wallet_exchange["exchange_order_id"],
                                             "warehouse_id": str(warehouse_id), "kind": "REFUND",
                                             "settlement_payment_method": "Wallet",
                                             "lines": [{"order_item_id": wallet_eligibility["items"][0]["order_item_id"],
                                                        "quantity": 1}]}
                    wallet_refund_quote = await quote(wallet_refund_payload)
                    assert Decimal(wallet_refund_quote["refund_amount"]) == 40
                    await record(wallet_refund_payload, wallet_refund_quote)
                    print("wallet exchange fee and nonrefundable receipt: pass", flush=True)

                    actor["role"] = RoleEnum.INVENTORY_CONTROLLER
                    must(await client.get(f"/api/v1/returns/eligibility/{first['id']}"), 403)
                    must(await client.get("/api/v1/orders/invoices"), 403)
                    actor["role"] = RoleEnum.ADMIN

                    balances = (await connection.execute(select(InventoryBalance.product_id,
                        InventoryBalance.current_stock).where(InventoryBalance.warehouse_id == warehouse_id))).all()
                    assert {row[0]: Decimal(row[1]) for row in balances} == {old_id: 5, new_id: 5}
                    payments = (await connection.execute(select(Payment.kind, Payment.amount).where(
                        Payment.user_id == user_id))).all()
                    assert sum((Decimal(amount) if kind == "SALE" else -Decimal(amount)
                                for kind, amount in payments), Decimal(0)) == Decimal("0.10")
                    current = must(await client.get("/api/v1/cash-register/current"), 200)
                    assert Decimal(str(current["expected_cash"])) == 30
                    summary = must(await client.get("/api/v1/reports/financial-summary"), 200)
                    assert Decimal(str(summary["net_sales"])) - Decimal(str(baseline["net_sales"])) == Decimal("0.10")
                    statement = must(await client.get(f"/api/v1/customers/{customer_id}/statement"), 200)
                    assert Decimal(str(statement["closing_balance"])) == 0
                    assert (await connection.execute(select(SalesReturn).where(
                        SalesReturn.user_id == user_id))).scalars().all()
                    print("permissions, stock, cash and idempotency: pass", flush=True)
            finally:
                app.dependency_overrides.pop(get_db, None)
                app.dependency_overrides.pop(get_current_user, None)
            assert outer.is_active, "The test escaped its rollback transaction"
        finally:
            if outer.is_active:
                await outer.rollback()
            assert (await connection.execute(select(User.id).where(User.id == user_id))).scalar_one_or_none() is None
            await connection.rollback()
    async with engine.connect() as check:
        assert (await check.execute(select(User.id).where(User.id == user_id))).scalar_one_or_none() is None
        assert (await check.execute(select(Product.id).where(Product.id.in_((old_id, new_id))))).first() is None
    await engine.dispose()
    print("rollback verified: no test rows persisted", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
