from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.dependencies import require_admin, require_inventory_access
from database import get_db
from models.user import User
from models.inventory import Warehouse
from schemas.purchase_document import PurchaseDocumentCreate, PurchaseDocumentInput, PurchaseDocumentResponse, PurchaseReceiptInput
from services.purchase_document_service import PurchaseDocumentService


router = APIRouter(prefix="/purchase-documents", tags=["Purchase Documents"])


@router.get("", response_model=list[PurchaseDocumentResponse])
async def list_documents(db: AsyncSession = Depends(get_db), _user: User = Depends(require_inventory_access)):
    return await PurchaseDocumentService.list_documents(db)


@router.get("/{document_id}", response_model=PurchaseDocumentResponse)
async def get_document(document_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(require_inventory_access)):
    document = await PurchaseDocumentService.get(db, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Purchase document not found")
    return document


@router.get("/{document_id}/print")
async def print_document_data(document_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(require_inventory_access)):
    document = await PurchaseDocumentService.get(db, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Purchase document not found")
    employee = (await db.execute(select(User.full_name, User.username, User.email).where(User.id == document.requested_by))).one_or_none()
    return {
        "id": str(document.id), "created_at": document.created_at,
        "employee_name": next((name for name in employee if name), "") if employee else "",
        "supplier_name": document.supplier_name, "status": document.status, "note": document.note,
        "lines": [{"product_name": line.product_name, "unit_name": line.unit_name, "quantity": line.quantity}
                  for line in document.lines],
    }


@router.get("/{document_id}/receipts/{receipt_id}/print")
async def print_purchase_receipt_data(document_id: UUID, receipt_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(require_inventory_access)):
    document = await PurchaseDocumentService.get(db, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Purchase document not found")
    receipt = next((row for row in document.receipts if row.id == receipt_id), None)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Purchase receipt not found")
    employee = (await db.execute(select(User.full_name, User.username, User.email).where(User.id == receipt.received_by))).one_or_none()
    warehouse_name = (await db.execute(select(Warehouse.name).where(Warehouse.id == receipt.warehouse_id))).scalar_one_or_none()
    by_line = {line.id: line for line in document.lines}
    return {
        "id": str(receipt.id), "created_at": receipt.created_at,
        "employee_name": next((name for name in employee if name), "") if employee else "",
        "supplier_name": document.supplier_name, "warehouse_name": warehouse_name or "",
        "supplier_document": f"أمر شراء {document.id}",
        "lines": [{"product_name": by_line[line.document_line_id].product_name,
                   "unit_name": by_line[line.document_line_id].base_unit_name,
                   "quantity": line.base_quantity}
                  for line in receipt.lines if line.document_line_id in by_line],
    }


@router.post("", response_model=PurchaseDocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(payload: PurchaseDocumentCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access)):
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


@router.post("/{document_id}/receipts", response_model=PurchaseDocumentResponse)
async def receive_document(document_id: UUID, payload: PurchaseReceiptInput, db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access)):
    try:
        await PurchaseDocumentService.receive(db, document_id, payload, user.id)
        return await PurchaseDocumentService.get(db, document_id)
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
