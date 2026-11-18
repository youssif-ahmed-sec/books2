"""Cashier markers against the isolated disposable PostgreSQL test fixture."""
import asyncio
from decimal import Decimal
from uuid import uuid4
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from core.dependencies import get_current_user
from database import AsyncSessionLocal
from main import app
from models.customer import Customer
from models.financial import Payment
from models.order import Order
from models.user import AuditLog, RoleEnum, User

@pytest.mark.asyncio
async def test_scan_cross_account_idempotent_without_financial_mutation():
    creator, cashier, customer_id, order_id, legacy_id, partial_id, zero_id = [uuid4() for _ in range(7)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=creator, role=RoleEnum.CASHIER_ORDERS), User(id=cashier, role=RoleEnum.CASHIER_ORDERS),
            Customer(id=customer_id, name="Marker test", balance=Decimal("170.00")),
            Order(id=order_id, public_number=901001, customer_id=customer_id, user_id=creator,
                  status="Delivered", payment_method="Cash", total_amount=100, cashier_collected=False, cashier_expected_amount=100),
            Order(id=legacy_id, public_number=901002, customer_id=customer_id, user_id=creator,
                  status="Delivered", payment_method="Cash", total_amount=50, cashier_collected=None),
            Order(id=partial_id, public_number=901003, customer_id=customer_id, user_id=creator,
                  status="Delivered", payment_method="Deferred Payment", total_amount=100, deferred_remaining=70,
                  cashier_collected=False, cashier_expected_amount=30),
            Order(id=zero_id, public_number=901004, customer_id=customer_id, user_id=creator,
                  status="Delivered", payment_method="Deferred Payment", total_amount=100, deferred_remaining=100,
                  cashier_collected=None),
        ])
        await db.flush()
        db.add(Payment(order_id=order_id, customer_id=customer_id, user_id=creator, amount=100, method="Cash", kind="SALE"))
        db.add(Payment(order_id=partial_id, customer_id=customer_id, user_id=creator, amount=30, method="Cash", kind="SALE"))
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: User(id=cashier, role=RoleEnum.CASHIER_ORDERS)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            before = await client.get("/api/v1/orders/invoices")
            assert not any(item["id"] == str(order_id) for item in before.json())
            payload = {"request_id": str(uuid4()), "query": "901001"}
            first, second = await asyncio.gather(*[client.post("/api/v1/orders/collect-scan", json=payload) for _ in range(2)])
            assert first.status_code == second.status_code == 201, (first.text, second.text)
            assert {first.json()["already_collected"], second.json()["already_collected"]} == {False, True}
            result = await client.get("/api/v1/orders/invoices")
            assert any(item["id"] == str(order_id) and item["cashier_collected"] is True for item in result.json())
            partial = await client.post("/api/v1/orders/collect-scan", json={"request_id": str(uuid4()), "query": "901003"})
            assert partial.status_code == 201 and Decimal(partial.json()["confirmed_amount"]) == Decimal("30.00")
            due = await client.get("/api/v1/orders/invoices?payment_status=due")
            assert any(item["id"] == str(partial_id) and item["cashier_collected"] is True and Decimal(str(item["deferred_remaining"])) == 70 for item in due.json())
            zero = await client.post("/api/v1/orders/collect-scan", json={"request_id": str(uuid4()), "query": "901004"})
            assert zero.status_code == 400
            legacy = await client.post("/api/v1/orders/collect-scan", json={"request_id": str(uuid4()), "query": "901002"})
            assert legacy.status_code == 400
        async with AsyncSessionLocal() as db:
            customer = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one()
            order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one()
            payments = (await db.execute(select(Payment).where(Payment.order_id == order_id))).scalars().all()
            audits = (await db.execute(select(AuditLog).where(AuditLog.entity_id == str(order_id), AuditLog.action == "CONFIRM_CASHIER_COLLECTION"))).scalars().all()
            partial_order = (await db.execute(select(Order).where(Order.id == partial_id))).scalar_one()
            partial_payments = (await db.execute(select(Payment).where(Payment.order_id == partial_id))).scalars().all()
            assert partial_order.deferred_remaining == Decimal("70.00") and len(partial_payments) == 1
            assert customer.balance == Decimal("170.00")
            assert order.cashier_collected is True and order.cashier_collected_by_id == cashier
            assert len(payments) == len(audits) == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
