"""Warehouse handoff journeys on the isolated disposable test database."""

import asyncio
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from core.dependencies import get_current_user
from database import AsyncSessionLocal
from main import app
from models.inventory import InventoryBalance, InventoryCount, InventoryTransaction, Warehouse
from models.product import Product, Supplier
from models.purchase import PurchaseOrder
from models.user import AuditLog, RoleEnum, User


def act_as(user_id, role):
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=role)


@pytest.mark.asyncio
async def test_warehouse_roles_movements_transfer_count_and_concurrent_issue():
    admin_id, controller_id, cashier_id, supplier_id, product_id, source_id, target_id, inactive_id = [uuid4() for _ in range(8)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=admin_id, role=RoleEnum.ADMIN),
            User(id=controller_id, role=RoleEnum.INVENTORY_CONTROLLER),
            User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS),
            Supplier(id=supplier_id, name="Warehouse handoff supplier"),
            Product(id=product_id, sku=f"WH-{product_id.hex[:12]}", name_ar="صنف مخزني", name_en="", base_unit="Piece", min_stock_level=2),
            Warehouse(id=source_id, name="Handoff source"),
            Warehouse(id=target_id, name="Handoff target"),
            Warehouse(id=inactive_id, name="Inactive handoff", is_active=False),
        ])
        await db.commit()

    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        async with client:
            app.dependency_overrides.pop(get_current_user, None)
            assert (await client.get("/api/v1/inventory/balances")).status_code == 401
            assert (await client.get("/api/v1/reports/stock-alerts")).status_code == 401

            act_as(cashier_id, RoleEnum.CASHIER_ORDERS)
            assert (await client.get("/api/v1/inventory/warehouses")).status_code == 200
            for path in ("/api/v1/inventory/balances", "/api/v1/inventory/transactions",
                         "/api/v1/inventory/transactions/recent", "/api/v1/purchases",
                         "/api/v1/reports/stock-alerts"):
                assert (await client.get(path)).status_code == 403, path
            assert (await client.post("/api/v1/inventory/counts", json={
                "request_id": str(uuid4()), "product_id": str(product_id),
                "warehouse_id": str(source_id), "observed_quantity": 1,
            })).status_code == 403

            act_as(controller_id, RoleEnum.INVENTORY_CONTROLLER)
            for path in ("/api/v1/inventory/balances", "/api/v1/inventory/transactions",
                         "/api/v1/inventory/transactions/recent", "/api/v1/purchases",
                         "/api/v1/reports/stock-alerts"):
                assert (await client.get(path)).status_code == 200, path
            assert (await client.get("/api/v1/inventory/transactions?page=0")).status_code == 422
            assert (await client.get("/api/v1/inventory/transactions?limit=10000")).status_code == 422

            receipt = {"request_id": str(uuid4()), "product_id": str(product_id),
                       "warehouse_id": str(source_id), "transaction_type": "Receiving",
                       "quantity_changed": "2.00", "supplier_id": str(supplier_id), "unit_cost": "7.25"}
            assert (await client.post("/api/v1/inventory/transactions", json={**receipt, "unit_cost": None})).status_code == 422
            assert (await client.post("/api/v1/inventory/transactions", json={**receipt, "quantity_changed": "0.001"})).status_code == 422
            assert (await client.post("/api/v1/inventory/transactions", json={**receipt, "quantity_changed": "-1"})).status_code == 400
            assert (await client.post("/api/v1/inventory/transactions", json={**receipt, "warehouse_id": str(inactive_id)})).status_code == 404
            assert (await client.post("/api/v1/inventory/transactions", json={**receipt, "product_id": str(uuid4())})).status_code == 404
            created = await client.post("/api/v1/inventory/transactions", json=receipt)
            assert created.status_code == 201, created.text
            assert (await client.post("/api/v1/inventory/transactions", json=receipt)).json()["id"] == created.json()["id"]
            assert (await client.post("/api/v1/inventory/transactions", json={**receipt, "quantity_changed": "3.00"})).status_code == 409
            alerts = (await client.get("/api/v1/reports/stock-alerts")).json()
            assert any(row["product_id"] == str(product_id) and row["severity"] == "low" for row in alerts)

            transfer = {"request_id": str(uuid4()), "product_id": str(product_id),
                        "source_warehouse_id": str(source_id), "target_warehouse_id": str(target_id), "quantity": "1.00"}
            assert (await client.post("/api/v1/inventory/transfers", json={**transfer, "quantity": "2.001"})).status_code == 422
            assert (await client.post("/api/v1/inventory/transfers", json={**transfer, "quantity": "3.00"})).status_code == 400
            assert (await client.post("/api/v1/inventory/transfers", json={**transfer, "target_warehouse_id": str(source_id)})).status_code == 400
            moved = await client.post("/api/v1/inventory/transfers", json=transfer)
            assert moved.status_code == 200, moved.text
            assert (await client.post("/api/v1/inventory/transfers", json=transfer)).status_code == 200
            assert (await client.post("/api/v1/inventory/transfers", json={**transfer, "quantity": "0.50"})).status_code == 409

            count = {"request_id": str(uuid4()), "product_id": str(product_id),
                     "warehouse_id": str(target_id), "observed_quantity": "2.00"}
            assert (await client.post("/api/v1/inventory/counts", json={**count, "observed_quantity": "-1"})).status_code == 422
            assert (await client.post("/api/v1/inventory/counts", json={**count, "observed_quantity": "1.001"})).status_code == 422
            counted = await client.post("/api/v1/inventory/counts", json=count)
            assert counted.status_code == 200 and counted.json()["difference"] == "1.00", counted.text
            assert (await client.post("/api/v1/inventory/counts", json=count)).json()["id"] == count["request_id"]
            assert (await client.post("/api/v1/inventory/counts", json={**count, "observed_quantity": "3.00"})).status_code == 409

            # Two stock issues race for the single remaining unit in source.
            issue = {"product_id": str(product_id), "warehouse_id": str(source_id),
                     "transaction_type": "Issuing", "quantity_changed": "-1.00"}
            results = await asyncio.gather(*(client.post("/api/v1/inventory/transactions", json={**issue, "request_id": str(uuid4())}) for _ in range(2)))
            assert sorted(response.status_code for response in results) == [201, 400], [response.text for response in results]

            act_as(admin_id, RoleEnum.ADMIN)
            assert (await client.delete(f"/api/v1/products/{product_id}")).status_code == 409
            assert (await client.post(f"/api/v1/suppliers/{supplier_id}/payments", json={
                "request_id": str(uuid4()), "amount": "1", "payment_method": "Cash",
            })).status_code == 404

        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(InventoryBalance).where(InventoryBalance.product_id == product_id))).scalars().all()
            assert {row.warehouse_id: row.current_stock for row in rows} == {source_id: Decimal("0"), target_id: Decimal("2")}
            for balance in rows:
                movement_sum = (await db.execute(select(func.coalesce(func.sum(InventoryTransaction.quantity_changed), 0)).where(
                    InventoryTransaction.product_id == product_id, InventoryTransaction.warehouse_id == balance.warehouse_id,
                ))).scalar_one()
                assert balance.current_stock == movement_sum
            assert (await db.execute(select(func.count(InventoryCount.id)).where(InventoryCount.product_id == product_id))).scalar_one() == 1
            assert (await db.execute(select(func.count(AuditLog.id)).where(AuditLog.entity_id == str(product_id)))).scalar_one() >= 3
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_purchase_approval_receipt_limit_and_archive_rule():
    admin_id, controller_id, cashier_id, supplier_id, product_id, warehouse_id = [uuid4() for _ in range(6)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=admin_id, role=RoleEnum.ADMIN), User(id=controller_id, role=RoleEnum.INVENTORY_CONTROLLER),
            User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS), Supplier(id=supplier_id, name="Purchase handoff supplier"),
            Product(id=product_id, sku=f"PO-{product_id.hex[:12]}", name_ar="صنف مشتريات", name_en="", base_unit="Piece"),
            Warehouse(id=warehouse_id, name="Purchase receiving warehouse"),
        ])
        await db.commit()

    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        async with client:
            request = {"product_id": str(product_id), "supplier_id": str(supplier_id), "quantity": "2.00"}
            act_as(cashier_id, RoleEnum.CASHIER_ORDERS)
            assert (await client.post("/api/v1/purchases", json=request)).status_code == 403
            act_as(controller_id, RoleEnum.INVENTORY_CONTROLLER)
            assert (await client.post("/api/v1/purchases", json={**request, "quantity": "1.001"})).status_code == 422
            created = await client.post("/api/v1/purchases", json=request)
            assert created.status_code == 201, created.text
            purchase_id = created.json()["id"]
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/approve")).status_code == 403
            act_as(admin_id, RoleEnum.ADMIN)
            assert (await client.delete(f"/api/v1/products/{product_id}")).status_code == 409
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/approve")).status_code == 200
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/approve")).status_code == 409
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/place")).status_code == 200
            act_as(controller_id, RoleEnum.INVENTORY_CONTROLLER)
            payload = {"request_id": str(uuid4()), "warehouse_id": str(warehouse_id), "quantity": "1.00", "unit_cost": "12.50"}
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/receive", json={**payload, "unit_cost": "12.501"})).status_code == 422
            first = await client.post(f"/api/v1/purchases/{purchase_id}/receive", json=payload)
            assert first.status_code == 200 and first.json()["received_quantity"] == "1.00", first.text
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/receive", json=payload)).status_code == 200
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/receive", json={**payload, "quantity": "2.00", "request_id": str(uuid4())})).status_code == 400
            final = await client.post(f"/api/v1/purchases/{purchase_id}/receive", json={**payload, "request_id": str(uuid4())})
            assert final.status_code == 200 and final.json()["status"] == "RECEIVED", final.text
            assert (await client.post(f"/api/v1/purchases/{purchase_id}/receive", json={**payload, "request_id": str(uuid4())})).status_code == 409

        async with AsyncSessionLocal() as db:
            order = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_id))).scalar_one()
            balance = (await db.execute(select(InventoryBalance).where(InventoryBalance.product_id == product_id))).scalar_one()
            product = (await db.execute(select(Product).where(Product.id == product_id))).scalar_one()
            assert order.received_quantity == Decimal("2") and balance.current_stock == Decimal("2")
            assert product.cost == Decimal("12.50")
            receipts = (await db.execute(select(InventoryTransaction).where(
                InventoryTransaction.reference_document == str(purchase_id),
            ))).scalars().all()
            assert len(receipts) == 2 and all(row.supplier_id == supplier_id and row.unit_cost == Decimal("12.50") for row in receipts)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
