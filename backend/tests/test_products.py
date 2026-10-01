import pytest
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
