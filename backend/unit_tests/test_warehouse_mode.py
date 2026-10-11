"""Warehouse handoff route and precision gates (no database writes)."""

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from main import app
from schemas.inventory import InventoryCountCreate, InventoryTransactionCreate, InventoryTransferCreate
from schemas.product import ProductCreate
from schemas.purchase import PurchaseReceive, PurchaseRequestCreate


def test_only_warehouse_routes_are_exposed_by_default():
    paths = set(app.openapi()["paths"])
    for path in (
        "/api/v1/products", "/api/v1/inventory/transactions",
        "/api/v1/inventory/transfers", "/api/v1/inventory/counts",
        "/api/v1/purchases", "/api/v1/reports/stock-alerts",
    ):
        assert path in paths
    for path in (
        "/api/v1/orders", "/api/v1/pos/checkout", "/api/v1/customers",
        "/api/v1/cash-register/open", "/api/v1/returns",
        "/api/v1/reports/sales", "/api/v1/financials/expenses",
    ):
        assert path not in paths


def test_paused_routes_return_404_and_inventory_requires_login():
    with TestClient(app) as client:
        assert client.get("/api/v1/customers").status_code == 404
        assert client.get("/api/v1/reports/sales").status_code == 404
        assert client.get("/api/v1/inventory/balances").status_code == 401
        assert client.get("/api/v1/reports/stock-alerts").status_code == 401


@pytest.mark.parametrize("schema,payload", [
    (InventoryTransactionCreate, {"transaction_type": "Receiving", "quantity_changed": "0.001"}),
    (InventoryTransferCreate, {"quantity": "0.001", "source_warehouse_id": uuid4(), "target_warehouse_id": uuid4()}),
    (InventoryCountCreate, {"observed_quantity": "1.001"}),
    (PurchaseRequestCreate, {"supplier_id": uuid4(), "quantity": "1.001"}),
    (PurchaseReceive, {"warehouse_id": uuid4(), "quantity": "1.001", "unit_cost": "1.00"}),
    (PurchaseReceive, {"warehouse_id": uuid4(), "quantity": "1.00", "unit_cost": "1.001"}),
    (ProductCreate, {"sku": "PRECISION", "name_ar": "منتج", "base_unit": "Piece", "initial_stock": "1.001"}),
])
def test_persisted_inventory_numbers_reject_hidden_rounding(schema, payload):
    common = {"product_id": uuid4(), "warehouse_id": uuid4(), "request_id": uuid4()}
    with pytest.raises(ValidationError):
        schema.model_validate({**common, **payload})


def test_two_decimal_stock_is_accepted():
    payload = InventoryCountCreate(product_id=uuid4(), warehouse_id=uuid4(),
                                   observed_quantity="1.25", request_id=uuid4())
    assert payload.observed_quantity == Decimal("1.25")
