from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from core.security import create_access_token
from database import AsyncSessionLocal
from main import app
from models.financial import CashShift, Payment
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse
from models.product import Product, ProductPrice, ProductUnit
from models.user import RoleEnum, User


def _auth(user_id):
    return {"Authorization": f"Bearer {create_access_token(str(user_id))}"}


@pytest.mark.asyncio
async def test_pos_discount_permissions_validation_and_settlement():
    cashier_id, admin_id, controller_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS),
            User(id=admin_id, role=RoleEnum.ADMIN),
            User(id=controller_id, role=RoleEnum.INVENTORY_CONTROLLER),
            Warehouse(id=warehouse_id, name="POS discount test"),
            Product(id=product_id, sku=f"DISC-{product_id.hex[:8]}", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
            CashShift(user_id=admin_id, opening_cash=0, status="OPEN"),
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=100))
        await db.commit()

    item = {"product_id": str(product_id), "unit_id": str(unit_id), "quantity": 1}
    base = {"warehouse_id": str(warehouse_id), "items": [item]}
    cashier = _auth(cashier_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        fixed = {**base, "request_id": str(uuid4()), "discount_amount": "10.25", "expected_total": "89.75"}
        percentage = {**base, "request_id": str(uuid4()), "discount_amount": "7.50",
                      "discount_percent": "7.50", "expected_total": "92.50"}
        fixed_sale = await client.post("/api/v1/orders", json=fixed, headers=cashier)
        assert fixed_sale.status_code == 201, fixed_sale.text
        percent_sale = await client.post("/api/v1/orders", json=percentage, headers=cashier)
        assert percent_sale.status_code == 201, percent_sale.text
        assert fixed_sale.json()["discount_amount"] == 10.25
        assert fixed_sale.json()["discount_percent"] is None
        assert percent_sale.json()["discount_amount"] == percent_sale.json()["discount_percent"] == 7.50

        retry = await client.post("/api/v1/orders", json=fixed, headers=cashier)
        assert retry.status_code == 201 and retry.json()["id"] == fixed_sale.json()["id"]
        conflict = await client.post("/api/v1/orders", json={**fixed, "discount_amount": "11"}, headers=cashier)
        assert conflict.status_code == 409, conflict.text

        admin_sale = await client.post("/api/v1/orders", json={**fixed, "request_id": str(uuid4())}, headers=_auth(admin_id))
        assert admin_sale.status_code == 201, admin_sale.text
        forbidden = await client.post("/api/v1/orders", json={**fixed, "request_id": str(uuid4())}, headers=_auth(controller_id))
        assert forbidden.status_code == 403, forbidden.text
        draft = await client.post("/api/v1/orders/draft", json={"items": [item], "discount_amount": "1"}, headers=cashier)
        assert draft.status_code == 403, draft.text

        for changes, status, detail in [
            ({"discount_amount": "101"}, 400, "Discount cannot exceed the order subtotal."),
            ({"discount_percent": "99"}, 400, "Discount percentage does not match the order subtotal."),
            ({"expected_total": "90"}, 400, "Prices changed. Refresh the cart before checkout."),
            ({"items": [{**item, "price_level": "Wholesale"}]}, 403,
             "Admin approval is required to change the customer's price level."),
        ]:
            rejected = await client.post("/api/v1/orders", json={**fixed, **changes, "request_id": str(uuid4())}, headers=cashier)
            assert rejected.status_code == status, rejected.text
            assert rejected.json()["detail"] == detail

    sale_ids = [UUID(response.json()["id"]) for response in (fixed_sale, percent_sale, admin_sale)]
    async with AsyncSessionLocal() as db:
        stock = await db.scalar(select(InventoryBalance.current_stock).where(InventoryBalance.product_id == product_id))
        assert stock == 7
        movements = (await db.scalars(select(InventoryTransaction.reference_document).where(
            InventoryTransaction.product_id == product_id,
        ))).all()
        assert sorted(movements) == sorted(str(sale_id) for sale_id in sale_ids)
        payments = dict((await db.execute(select(Payment.order_id, Payment.amount).where(Payment.order_id.in_(sale_ids)))).all())
        assert payments == dict(zip(sale_ids, [Decimal("89.75"), Decimal("92.50"), Decimal("89.75")]))
