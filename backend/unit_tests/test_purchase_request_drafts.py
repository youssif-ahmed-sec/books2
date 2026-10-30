import asyncio
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from api.v1 import purchase_documents as route
from api.v1 import purchases as legacy_route
from core.dependencies import require_admin
from models.purchase_document import PurchaseDocument, PurchaseDocumentLine
from models.user import RoleEnum
from services.purchase_document_service import PurchaseDocumentService


class Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value

    def scalar_one(self):
        return self.value

    def first(self):
        return self.value

    def scalars(self):
        return self

    def all(self):
        return self.value


def test_quick_request_needs_only_product_and_serializes_same_product(monkeypatch):
    product_id, unit_id, user_id = uuid4(), uuid4(), uuid4()
    product = SimpleNamespace(
        id=product_id, name_ar="كتاب", base_unit="قطعة",
        units=[SimpleNamespace(id=unit_id, unit_name="قطعة", conversion_factor=Decimal("1"), is_deleted=False)],
    )

    class Db:
        def __init__(self):
            self.results = [Result(product), Result(None)]
            self.queries = []
            self.added = []
            self.committed = False

        async def execute(self, query):
            self.queries.append(str(query))
            return self.results.pop(0)

        def add(self, row):
            self.added.append(row)

        async def commit(self):
            self.committed = True

        async def refresh(self, row):
            row.public_number = 123

    async def fake_notify(*args, **kwargs):
        return None

    monkeypatch.setattr(route, "notify_roles", fake_notify)
    db = Db()
    response = asyncio.run(route.quick_purchase_request(
        route.QuickPurchaseRequestInput(product_id=product_id), db,
        SimpleNamespace(id=user_id, role=RoleEnum.INVENTORY_CONTROLLER),
    ))
    document = next(row for row in db.added if isinstance(row, PurchaseDocument))
    line = next(row for row in db.added if isinstance(row, PurchaseDocumentLine))
    assert "FOR UPDATE" in db.queries[0]
    assert document.supplier_id is None and document.supplier_name == ""
    assert line.quantity is None and line.base_quantity is None
    assert response["already_exists"] is False and db.committed


def test_manager_must_complete_request_before_approval():
    document = SimpleNamespace(id=uuid4(), status="REQUESTED", supplier_id=None)

    class Db:
        def __init__(self):
            self.results = [Result(document), Result([SimpleNamespace(quantity=None, base_quantity=None)])]
            self.committed = False

        async def execute(self, query):
            return self.results.pop(0)

        async def commit(self):
            self.committed = True

    db = Db()
    with pytest.raises(ValueError, match="المورد والكميات"):
        asyncio.run(PurchaseDocumentService.transition(db, document.id, "approve", uuid4()))
    assert document.status == "REQUESTED" and not db.committed


def test_quick_request_reuses_existing_open_order():
    product_id = uuid4()
    product = SimpleNamespace(id=product_id)
    existing = SimpleNamespace(id=uuid4(), public_number=47)

    class Db:
        def __init__(self):
            self.results = [Result(product), Result((SimpleNamespace(), existing))]
            self.added = []

        async def execute(self, query):
            return self.results.pop(0)

        def add(self, row):
            self.added.append(row)

    db = Db()
    response = asyncio.run(route.quick_purchase_request(
        route.QuickPurchaseRequestInput(product_id=product_id), db,
        SimpleNamespace(id=uuid4(), role=RoleEnum.INVENTORY_CONTROLLER),
    ))
    assert response["already_exists"] is True
    assert response["public_number"] == 47
    assert db.added == []


def test_inventory_controller_cannot_open_another_persons_request(monkeypatch):
    document = SimpleNamespace(id=uuid4(), requested_by=uuid4())

    async def fake_get(db, document_id):
        return document

    monkeypatch.setattr(PurchaseDocumentService, "get", fake_get)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(route.visible_document(
            SimpleNamespace(), document.id,
            SimpleNamespace(id=uuid4(), role=RoleEnum.INVENTORY_CONTROLLER),
        ))
    assert raised.value.status_code == 404


def test_legacy_creation_requires_admin_and_quick_request_requires_inventory_role():
    creation = next(item for item in legacy_route.router.routes
                    if item.path == "/purchases" and "POST" in item.methods)
    assert any(dependency.call is require_admin for dependency in creation.dependant.dependencies)

    with pytest.raises(HTTPException) as raised:
        asyncio.run(route.quick_purchase_request(
            route.QuickPurchaseRequestInput(product_id=uuid4()),
            SimpleNamespace(), SimpleNamespace(id=uuid4(), role=RoleEnum.ADMIN),
        ))
    assert raised.value.status_code == 403


def test_admin_purchase_create_commits_as_approved(monkeypatch):
    from schemas.purchase_document import PurchaseDocumentCreate
    from models.user import AuditLog

    supplier_id, product_id, unit_id, user_id, request_id = (uuid4() for _ in range(5))
    payload = PurchaseDocumentCreate(supplier_id=supplier_id, request_id=request_id,
        lines=[{"product_id": product_id, "unit_id": unit_id, "quantity": "2"}])
    line = SimpleNamespace()

    class Db:
        def __init__(self):
            self.results = [Result(None), Result("مورد")]
            self.added = []
            self.committed = False

        async def execute(self, query):
            return self.results.pop(0)

        def add(self, value):
            self.added.append(value)

        def add_all(self, values):
            self.added.extend(values)

        async def commit(self):
            self.committed = True

    async def build_lines(db, document_id, data):
        return [line]

    monkeypatch.setattr(PurchaseDocumentService, "build_lines", build_lines)
    db = Db()
    document_id = asyncio.run(PurchaseDocumentService.create(db, payload, user_id))
    document = next(item for item in db.added if isinstance(item, PurchaseDocument))
    assert document.id == document_id and document.status == "APPROVED"
    assert document.requested_by == user_id and document.approved_by == user_id and db.committed
    assert any(isinstance(item, AuditLog) and item.action == "APPROVE_PURCHASE_DOCUMENT"
               and item.new_value["status"] == "APPROVED" for item in db.added)


def test_purchase_creation_is_admin_only_and_retries_do_not_duplicate():
    from schemas.purchase_document import PurchaseDocumentCreate
    from core.idempotency import request_fingerprint

    creation = next(item for item in route.router.routes
                    if item.path == "/purchase-documents" and "POST" in item.methods)
    assert any(dependency.call is require_admin for dependency in creation.dependant.dependencies)
    user_id = uuid4()
    payload = PurchaseDocumentCreate(supplier_id=uuid4(), request_id=uuid4(),
        lines=[{"product_id": uuid4(), "unit_id": uuid4(), "quantity": "2"}])
    existing = SimpleNamespace(id=uuid4(), request_fingerprint=request_fingerprint(payload), requested_by=user_id)

    class Db:
        async def execute(self, query):
            return Result(existing)

    assert asyncio.run(PurchaseDocumentService.create(Db(), payload, user_id)) == existing.id
    with pytest.raises(ValueError, match="Request ID"):
        asyncio.run(PurchaseDocumentService.create(Db(), payload, uuid4()))
    changed = payload.model_copy(update={"note": "different"})
    with pytest.raises(ValueError, match="Request ID"):
        asyncio.run(PurchaseDocumentService.create(Db(), changed, user_id))
