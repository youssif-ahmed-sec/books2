import hashlib
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select

from core.dependencies import require_admin, require_inventory_access
from database import get_db
from models.user import AuditLog, RoleEnum, User
from models.inventory import Warehouse
from models.product import Product
from models.purchase_document import PurchaseDocument, PurchaseDocumentLine
from schemas.purchase_document import PurchaseDocumentCreate, PurchaseDocumentInput, PurchaseDocumentResponse, PurchaseReceiptInput
from services.notification_service import notify_roles
from services.purchase_document_service import PurchaseDocumentService


class QuickPurchaseRequestInput(BaseModel):
    product_id: UUID
    model_config = ConfigDict(extra="forbid")


class PurchaseDocumentSupplierUpdate(BaseModel):
    supplier_id: UUID
    model_config = ConfigDict(extra="forbid")


router = APIRouter(prefix="/purchase-documents", tags=["Purchase Documents"])


async def visible_document(db: AsyncSession, document_id: UUID, user: User) -> PurchaseDocument:
    document = await PurchaseDocumentService.get(db, document_id)
    if document is None or (user.role != RoleEnum.ADMIN and document.requested_by != user.id):
        raise HTTPException(status_code=404, detail="Purchase document not found")
    return document


@router.get("", response_model=list[PurchaseDocumentResponse])
async def list_documents(db: AsyncSession = Depends(get_db), _user: User = Depends(require_inventory_access)):
    return await PurchaseDocumentService.list_documents(db, None if _user.role == RoleEnum.ADMIN else _user.id)


@router.post("/quick-request")
async def quick_purchase_request(
    payload: QuickPurchaseRequestInput,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    if user.role != RoleEnum.INVENTORY_CONTROLLER:
        raise HTTPException(status_code=403, detail="طلب الشراء السريع متاح لأمين المخزن فقط")
    product = (await db.execute(
        select(Product).options(
            selectinload(Product.units),
        ).where(
            Product.id == payload.product_id,
            Product.is_deleted == False,
            Product.is_active == True,
            Product.is_bundle == False,
        ).with_for_update(of=Product)
    )).scalar_one_or_none()

    if product is None:
        raise HTTPException(status_code=404, detail="المنتج غير متاح لطلب الشراء.")

    existing_line = (await db.execute(
        select(PurchaseDocumentLine, PurchaseDocument)
        .join(PurchaseDocument, PurchaseDocument.id == PurchaseDocumentLine.document_id)
        .where(
            PurchaseDocumentLine.product_id == payload.product_id,
            PurchaseDocument.status.in_(("REQUESTED", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED")),
        )
    )).first()

    if existing_line:
        _, existing_doc = existing_line
        return {
            "id": str(existing_doc.id),
            "public_number": existing_doc.public_number,
            "message": f"يوجد طلب شراء مفتوح بالفعل لهذا المنتج برقم {existing_doc.public_number}.",
            "already_exists": True,
        }

    active_units = [u for u in product.units if not u.is_deleted]
    if not active_units:
        raise HTTPException(status_code=400, detail="المنتج لا يحتوي على وحدات قياس متاحة.")

    chosen_unit = next((u for u in active_units if u.unit_name == product.base_unit or u.conversion_factor == 1), active_units[0])

    doc_id = uuid.uuid4()
    req_id = uuid.uuid4()
    fingerprint = hashlib.sha256(f"quick-request:{doc_id}:{payload.product_id}".encode()).hexdigest()

    doc = PurchaseDocument(
        id=doc_id,
        request_id=req_id,
        request_fingerprint=fingerprint,
        supplier_id=None,
        supplier_name="",
        note=f"طلب شراء سريع من أمين المخزن للصنف {product.name_ar}",
        requested_by=user.id,
        status="REQUESTED",
    )

    line = PurchaseDocumentLine(
        id=uuid.uuid4(),
        document_id=doc_id,
        product_id=product.id,
        unit_id=chosen_unit.id,
        product_name=product.name_ar,
        unit_name=chosen_unit.unit_name,
        base_unit_name=product.base_unit,
        quantity=None,
        conversion_factor=chosen_unit.conversion_factor,
        base_quantity=None,
        received_base_quantity=0,
    )

    db.add(doc)
    db.add(line)
    db.add(AuditLog(
        user_id=user.id,
        action="QUICK_PURCHASE_REQUEST",
        entity_type="PurchaseDocument",
        entity_id=str(doc_id),
        new_value={"product_id": str(product.id)}
    ))

    await notify_roles(
        db,
        (RoleEnum.ADMIN,),
        kind="purchase_request",
        title="طلب شراء جديد من أمين المخزن",
        message=f"طلب شراء للصنف {product.name_ar}",
        href="/purchases",
    )

    await db.commit()
    await db.refresh(doc)

    return {
        "id": str(doc.id),
        "public_number": doc.public_number,
        "message": f"تم إرسال طلب الشراء للمدير بنجاح برقم {doc.public_number}.",
        "already_exists": False,
    }


@router.get("/{document_id}", response_model=PurchaseDocumentResponse)
async def get_document(document_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access)):
    return await visible_document(db, document_id, user)


@router.get("/{document_id}/print")
async def print_document_data(document_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access)):
    document = await visible_document(db, document_id, user)
    if document.supplier_id is None or any(line.quantity is None for line in document.lines):
        raise HTTPException(status_code=409, detail="Purchase request is not ready for printing")
    employee = (await db.execute(select(User.full_name, User.username, User.email).where(User.id == document.requested_by))).one_or_none()
    return {
        "id": str(document.id), "public_number": document.public_number, "created_at": document.created_at,
        "employee_name": next((name for name in employee if name), "") if employee else "",
        "supplier_name": document.supplier_name, "status": document.status, "note": document.note,
        "lines": [{"product_name": line.product_name, "unit_name": line.unit_name, "quantity": line.quantity}
                  for line in document.lines],
    }


@router.get("/{document_id}/receipts/{receipt_id}/print")
async def print_purchase_receipt_data(document_id: UUID, receipt_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access)):
    document = await visible_document(db, document_id, user)
    receipt = next((row for row in document.receipts if row.id == receipt_id), None)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Purchase receipt not found")
    employee = (await db.execute(select(User.full_name, User.username, User.email).where(User.id == receipt.received_by))).one_or_none()
    warehouse_name = (await db.execute(select(Warehouse.name).where(Warehouse.id == receipt.warehouse_id))).scalar_one_or_none()
    by_line = {line.id: line for line in document.lines}
    return {
        "id": str(receipt.id), "public_number": receipt.public_number, "created_at": receipt.created_at,
        "employee_name": next((name for name in employee if name), "") if employee else "",
        "supplier_name": document.supplier_name, "warehouse_name": warehouse_name or "",
        "supplier_document": f"أمر شراء {document.public_number}",
        "lines": [{"product_name": by_line[line.document_line_id].product_name,
                   "unit_name": by_line[line.document_line_id].base_unit_name,
                   "quantity": line.base_quantity}
                  for line in receipt.lines if line.document_line_id in by_line],
    }


@router.post("", response_model=PurchaseDocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(payload: PurchaseDocumentCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    try:
        document_id = await PurchaseDocumentService.create(db, payload, user.id)
        return await PurchaseDocumentService.get(db, document_id)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409 if "Request ID" in str(exc) else 400, detail=str(exc)) from exc


@router.put("/{document_id}", response_model=PurchaseDocumentResponse)
async def edit_document(document_id: UUID, payload: PurchaseDocumentInput, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    try:
        await PurchaseDocumentService.edit(db, document_id, payload, user.id)
        return await PurchaseDocumentService.get(db, document_id)
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
@router.post("/{document_id}/status/{action}", response_model=PurchaseDocumentResponse)
async def transition_document(document_id: UUID, action: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    if action not in ("approve", "reject", "place", "cancel"):
        raise HTTPException(status_code=404, detail="Purchase action not found")
    try:
        await PurchaseDocumentService.transition(db, document_id, action, user.id)
        return await PurchaseDocumentService.get(db, document_id)
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/{document_id}/supplier", response_model=PurchaseDocumentResponse)
async def update_document_supplier(document_id: UUID, payload: PurchaseDocumentSupplierUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    try:
        return await PurchaseDocumentService.update_supplier(db, document_id, payload.supplier_id, user.id)
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{document_id}/receipts", response_model=PurchaseDocumentResponse)
async def receive_document(document_id: UUID, payload: PurchaseReceiptInput, db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access)):
    await visible_document(db, document_id, user)
    try:
        await PurchaseDocumentService.receive(db, document_id, payload, user.id)
        return await PurchaseDocumentService.get(db, document_id)
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
