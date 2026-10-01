import pytest
from decimal import Decimal
from httpx import AsyncClient, ASGITransport
from core.dependencies import get_current_user
from models.user import User, RoleEnum
from main import app

# Mock authentication only, let database hit the real test database
async def override_get_current_user():
    user = User()
    user.id = "00000000-0000-0000-0000-000000000001"
    user.role = RoleEnum.ADMIN
    return user

app.dependency_overrides[get_current_user] = override_get_current_user

import pytest_asyncio

@pytest_asyncio.fixture
async def async_client():
    app.router.on_startup.clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

@pytest.mark.asyncio
async def test_read_products_empty(async_client):
    response = await async_client.get("/api/v1/products")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert data["data"] == []

@pytest.mark.asyncio
async def test_create_product(async_client):
    import uuid
    sku = f"TEST-SKU-{uuid.uuid4().hex[:6]}"
    payload = {
        "sku": sku,
        "name_ar": "منتج تجريبي",
        "name_en": "Test Product",
        "cost": 10.0,
        "price": 20.0,
        "min_stock_level": 5,
        "initial_stock": 10,
        "base_unit": "Piece"
    }
    response = await async_client.post("/api/v1/products", json=payload)
    assert response.status_code == 201, response.json()
    data = response.json()
    assert data["sku"] == sku
    assert data["name_en"] == "Test Product"
    
    # Verify stock creation
    assert "id" in data


@pytest.mark.asyncio
async def test_receipt_keeps_supplier_purchase_value_after_product_cost_changes(async_client):
    import uuid

    supplier_response = await async_client.post("/api/v1/suppliers", json={"name": "Receipt test supplier"})
    assert supplier_response.status_code == 201, supplier_response.text
    supplier_id = supplier_response.json()["id"]

    product_response = await async_client.post("/api/v1/products", json={
        "sku": f"RECEIPT-{uuid.uuid4().hex[:10]}",
        "name_ar": "منتج استلام تجريبي",
        "name_en": "Receipt test product",
        "base_unit": "Piece",
        "cost": "5",
        "initial_stock": "1",
        "supplier_id": supplier_id,
    })
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    warehouses_response = await async_client.get("/api/v1/inventory/warehouses")
    assert warehouses_response.status_code == 200
    warehouse_id = warehouses_response.json()[0]["id"]

    receipt_response = await async_client.post("/api/v1/inventory/transactions", json={
        "product_id": product_id,
        "warehouse_id": warehouse_id,
        "supplier_id": supplier_id,
        "transaction_type": "Receiving",
        "quantity_changed": "2",
        "unit_cost": "7",
    })
    assert receipt_response.status_code == 201, receipt_response.text
    assert "unit_cost" not in receipt_response.json()

    updated = await async_client.put(f"/api/v1/products/{product_id}", json={"cost": "100"})
    assert updated.status_code == 200, updated.text

    statement_response = await async_client.get(f"/api/v1/suppliers/{supplier_id}")
    assert statement_response.status_code == 200, statement_response.text
    statement = statement_response.json()
    assert Decimal(statement["total_purchases"]) == Decimal("14")
    assert Decimal(statement["balance"]) == Decimal("14")
    assert statement["statement_incomplete"] is False
