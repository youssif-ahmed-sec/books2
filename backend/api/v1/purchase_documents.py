from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_inventory_access
from database import get_db
from models.user import User
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
