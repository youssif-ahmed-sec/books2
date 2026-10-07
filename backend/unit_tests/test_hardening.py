from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import hmac
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.v1.inventory import create_inventory_transaction
from api.v1.upload import matches_image_type
from core.dependencies import get_current_user, require_warehouse_access
from core.product_access import visible_product
from core.security import create_access_token
from core.supplier_access import visible_supplier, visible_supplier_detail
from main import app
import main
from models.order import Order, OrderStatusEnum
from models.user import RoleEnum
from schemas.inventory import InventoryTransactionCreate
from schemas.financial import ExpenseCreate
from schemas.auth import UserRegisterRequest
from schemas.order import OrderCreate, OrderDraftCreate, OrderItemCreate, OrderStatusUpdate
from schemas.product import ProductCreate, SupplierPaymentCreate
from services.order_service import OrderService
from services.order_workflow import allowed_next_statuses


@pytest.mark.parametrize(
    "path",
    ["/api/v1/financials/expenses", "/api/v1/customers", "/api/v1/products"],
)
def test_sensitive_reads_require_login(path):
    with TestClient(app) as client:
        assert client.get(path).status_code == 401


def test_every_private_api_route_declares_authentication():
    public_paths = {"/api/v1/auth/login", "/api/v1/webhooks/whatsapp"}

    def calls_dependency(dependant, target):
        return any(
            dependency.call is target or calls_dependency(dependency, target)
            for dependency in dependant.dependencies
        )

    uncovered = [
        route.path
        for route in app.routes
        if route.path.startswith("/api/v1/")
        and route.path not in public_paths
        and not calls_dependency(route.dependant, get_current_user)
    ]
    assert uncovered == []


def test_inventory_transaction_history_requires_login():
    with TestClient(app) as client:
        assert client.get("/api/v1/inventory/transactions").status_code == 401


def test_cashier_cannot_read_inventory_transaction_history():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=RoleEnum.CASHIER_ORDERS)
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/inventory/transactions").status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.parametrize(
    "role,path",
    [
        (RoleEnum.INVENTORY_CONTROLLER, "/api/v1/reports/sales"),
        (RoleEnum.SENIOR_SALES, "/api/v1/reports/sales"),
        (RoleEnum.SENIOR_SALES, "/api/v1/dashboards/management"),
        (RoleEnum.INVENTORY_CONTROLLER, "/api/v1/dashboards/management"),
        (RoleEnum.SENIOR_SALES, "/api/v1/reports/inventory"),
        (RoleEnum.INVENTORY_CONTROLLER, "/api/v1/reports/inventory"),
    ],
)
def test_reports_keep_sales_and_inventory_roles_separate(role, path):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=role)
    try:
        with TestClient(app) as client:
            assert client.get(path).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_invalid_user_id_in_signed_token_returns_401():
    token = create_access_token(subject="not-a-uuid")
    with TestClient(app) as client:
        response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_cross_origin_preflight_is_not_open_to_any_site():
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/products",
            headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"},
        )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_static_file_lookup_cannot_escape_export_directory(tmp_path, monkeypatch):
    static_root = tmp_path / "static"
    static_root.mkdir()
    (static_root / "index.html").write_text("public")
    (tmp_path / "secret.html").write_text("private")
    monkeypatch.setattr(main, "static_dir", str(static_root))
    assert main.safe_static_file("index.html") == static_root / "index.html"
    assert main.safe_static_file("../secret.html") is None


def test_static_selection_skips_incomplete_packaged_export(tmp_path):
    packaged = tmp_path / "backend" / "static"
    packaged.mkdir(parents=True)
    (packaged / "old-chunk.js").write_text("old")
    export = tmp_path / "frontend" / "out"
    export.mkdir(parents=True)
    (export / "index.html").write_text("current")

    assert main.select_static_dir(packaged, export) == export
    assert main.select_static_dir(packaged) is None


def test_upload_type_checks_file_signature():
    assert matches_image_type("image/png", b"\x89PNG\r\n\x1a\nrest")
    assert not matches_image_type("image/png", b"not really a PNG")


def test_cashier_cannot_upload_inventory_images():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=RoleEnum.CASHIER_ORDERS)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/upload/image",
                files={"file": ("book.png", b"\x89PNG\r\n\x1a\n", "image/png")},
            )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_inventory_controller_can_access_warehouse_catalog():
    user = SimpleNamespace(role=RoleEnum.INVENTORY_CONTROLLER)
    assert await require_warehouse_access(user) is user


@pytest.mark.parametrize(
    "path",
    ["/api/v1/financials/expenses", "/api/v1/financials/incomes"],
)
def test_financial_reads_reject_non_admin(path):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=RoleEnum.CASHIER_ORDERS)
    try:
        with TestClient(app) as client:
            assert client.get(path).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_product_write_rejects_non_inventory_staff():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=RoleEnum.CASHIER_ORDERS)
    try:
        with TestClient(app) as client:
            assert client.delete(f"/api/v1/products/{uuid4()}").status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.parametrize(
    "path",
    ["/api/v1/suppliers", "/api/v1/dashboards/management"],
)
def test_cashier_cannot_read_management_or_supplier_financial_data(path):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=RoleEnum.CASHIER_ORDERS)
    try:
        with TestClient(app) as client:
            assert client.get(path).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_inventory_controller_cannot_record_supplier_payment():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=RoleEnum.INVENTORY_CONTROLLER)
    try:
        with TestClient(app) as client:
            response = client.post(f"/api/v1/suppliers/{uuid4()}/payments", json={"amount": "5"})
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_inventory_controller_cannot_change_supplier_financial_fields():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=RoleEnum.INVENTORY_CONTROLLER)
    try:
        with TestClient(app) as client:
            response = client.post("/api/v1/suppliers", json={"name": "Supplier", "opening_balance": "100"})
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_supplier_financial_fields_are_redacted_for_inventory_role():
    supplier = {"id": uuid4(), "name": "Supplier", "opening_balance": Decimal("100"), "credit_limit": Decimal("500")}
    visible = visible_supplier(supplier, RoleEnum.INVENTORY_CONTROLLER)
    assert visible.opening_balance is None
    assert visible.credit_limit is None
    detail = visible_supplier_detail({**supplier, "balance": Decimal("250"), "total_payments": Decimal("50")}, RoleEnum.INVENTORY_CONTROLLER)
    assert detail.balance is None
    assert detail.total_payments is None
    assert detail.payments == []


def test_whatsapp_webhook_rejects_bad_signature(monkeypatch):
    monkeypatch.setenv("WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "unit-test-secret")
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/webhooks/whatsapp", content=b"{}",
            headers={"x-hub-signature-256": "sha256=invalid"},
        ).status_code == 403


def test_whatsapp_webhook_accepts_valid_signature(monkeypatch):
    monkeypatch.setenv("WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "unit-test-secret")
    payload = b"{}"
    signature = "sha256=" + hmac.new(b"unit-test-secret", payload, hashlib.sha256).hexdigest()
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/webhooks/whatsapp", content=payload,
            headers={"x-hub-signature-256": signature},
        )
    assert response.status_code == 404  # Authenticated request reached payload handling.


def test_whatsapp_webhook_does_not_acknowledge_unhandled_message(monkeypatch):
    monkeypatch.setenv("WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "unit-test-secret")
    payload = b'{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"id":"m1"}]}}]}]}'
    signature = "sha256=" + hmac.new(b"unit-test-secret", payload, hashlib.sha256).hexdigest()
    with TestClient(app) as client:
        response = client.post("/api/v1/webhooks/whatsapp", content=payload,
                               headers={"x-hub-signature-256": signature})
    assert response.status_code == 503


def test_whatsapp_webhook_is_disabled_without_launch_flag(monkeypatch):
    monkeypatch.delenv("WHATSAPP_ENABLED", raising=False)
    with TestClient(app) as client:
        assert client.get("/api/v1/webhooks/whatsapp").status_code == 404
        assert client.post("/api/v1/webhooks/whatsapp", content=b"{}").status_code == 404


def test_product_cost_is_hidden_from_cashier():
    product = {
        "id": uuid4(), "sku": "T-1", "name_en": "Book", "name_ar": "كتاب",
        "base_unit": "Piece", "cost": Decimal("12.50"), "is_deleted": False,
        "created_at": datetime.now(timezone.utc),
    }
    assert visible_product(product, RoleEnum.CASHIER_ORDERS).cost is None
    assert visible_product(product, RoleEnum.INVENTORY_CONTROLLER).cost == Decimal("12.50")


@pytest.mark.parametrize("quantity", [0, -1])
def test_order_rejects_nonpositive_quantity(quantity):
    with pytest.raises(ValidationError):
        OrderItemCreate(product_id=uuid4(), unit_id=uuid4(), quantity=quantity)


def test_product_rejects_negative_initial_stock():
    with pytest.raises(ValidationError):
        ProductCreate(sku="T-1", name_en="Book", name_ar="كتاب", base_unit="Piece", initial_stock=-1)


def test_financial_inputs_require_positive_amount():
    with pytest.raises(ValidationError):
        ExpenseCreate(category="rent", amount=0)
    with pytest.raises(ValidationError):
        SupplierPaymentCreate(amount=-1)


def test_new_user_password_must_be_long_enough_without_bcrypt_truncation():
    with pytest.raises(ValidationError):
        UserRegisterRequest(email="user@example.com", password="short")
    with pytest.raises(ValidationError):
        UserRegisterRequest(email="user@example.com", password="a" * 73)


def test_order_creation_cannot_claim_a_status_without_matching_stock_behavior():
    item = {"product_id": uuid4(), "unit_id": uuid4(), "quantity": 1}
    with pytest.raises(ValidationError):
        OrderCreate(request_id=uuid4(), warehouse_id=uuid4(), status=OrderStatusEnum.CANCELLED, items=[item])
    with pytest.raises(ValidationError):
        OrderDraftCreate(status=OrderStatusEnum.DELIVERED, items=[item])


def test_stock_mutations_require_a_retry_identity():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uuid4(), role=RoleEnum.ADMIN)
    try:
        with TestClient(app) as client:
            order = client.post("/api/v1/orders", json={
                "warehouse_id": str(uuid4()),
                "items": [{"product_id": str(uuid4()), "unit_id": str(uuid4()), "quantity": 1}],
            })
            receipt = client.post("/api/v1/inventory/transactions", json={
                "product_id": str(uuid4()), "warehouse_id": str(uuid4()),
                "transaction_type": "Receiving", "quantity_changed": 1,
                "supplier_id": str(uuid4()), "unit_cost": 5,
            })
        assert order.status_code == 422
        assert receipt.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_user, None)


class Result:
    def __init__(self, value=None, values=None):
        self.value = value
        self.values = values or []

    def scalar_one_or_none(self):
        return self.value

    def scalars(self):
        return SimpleNamespace(all=lambda: self.values)


class Session:
    def __init__(self, results):
        self.results = iter(results)
        self.calls = 0
        self.commits = 0

    async def execute(self, _query):
        self.calls += 1
        return next(self.results)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _value):
        pass


@pytest.mark.asyncio
async def test_delivering_previously_issued_order_does_not_deduct_again():
    order = Order(
        id=uuid4(), status=OrderStatusEnum.READY.value, source="Manual Entry",
        total_amount=Decimal("10"), tax_amount=Decimal("0"),
        discount_amount=Decimal("0"), shipping_cost=Decimal("0"),
        payment_method="Cash", created_at=datetime.now(timezone.utc),
    )
    session = Session([Result(value=order), Result(value=uuid4()), Result(values=[])])
    result = await OrderService.update_order_status(
        session, order.id, OrderStatusUpdate(status=OrderStatusEnum.DELIVERED), uuid4()
    )
    assert result["status"] == OrderStatusEnum.DELIVERED.value
    assert session.calls == 3
    assert session.commits == 1


@pytest.mark.asyncio
async def test_fulfilled_order_cannot_reopen_without_stock_reversal():
    order = Order(id=uuid4(), status=OrderStatusEnum.DELIVERED.value)
    session = Session([Result(value=order)])
    with pytest.raises(ValueError, match="return or refund"):
        await OrderService.update_order_status(
            session, order.id, OrderStatusUpdate(status=OrderStatusEnum.CANCELLED), uuid4()
        )
    assert session.commits == 0


@pytest.mark.asyncio
async def test_order_cannot_skip_stages_or_reopen_cancelled_order():
    assert allowed_next_statuses(OrderStatusEnum.READY.value) == [
        OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CANCELLED.value,
    ]
    assert allowed_next_statuses(OrderStatusEnum.DELIVERED.value) == [OrderStatusEnum.CLOSED.value]
    for start in (OrderStatusEnum.DRAFT, OrderStatusEnum.CANCELLED):
        order = Order(id=uuid4(), status=start.value)
        session = Session([Result(value=order)])
        with pytest.raises(ValueError, match="not allowed"):
            await OrderService.update_order_status(
                session, order.id, OrderStatusUpdate(status=OrderStatusEnum.DELIVERED), uuid4()
            )
        assert session.commits == 0


@pytest.mark.asyncio
async def test_manual_issue_cannot_make_stock_negative():
    balance = SimpleNamespace(current_stock=Decimal("1"))
    session = Session([Result(), Result(value=SimpleNamespace(id=uuid4())), Result(value=uuid4()), Result(value=balance)])
    transaction = InventoryTransactionCreate(
        request_id=uuid4(),
        product_id=uuid4(), warehouse_id=uuid4(),
        transaction_type="Issuing", quantity_changed=Decimal("-2"),
    )
    with pytest.raises(HTTPException) as error:
        await create_inventory_transaction(transaction, session, SimpleNamespace(id=uuid4()))
    assert error.value.status_code == 400
    assert session.commits == 0
