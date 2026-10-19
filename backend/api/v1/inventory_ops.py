from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_inventory_access
from core.feature_flags import require_full_mode
from core.idempotency import request_fingerprint
from database import get_db
from models.inventory import InventoryBalance, InventoryCount, InventoryCountSession, InventoryTransaction, TransactionTypeEnum, Warehouse
from models.product import Product
from models.user import AuditLog, RoleEnum, User
from schemas.inventory import CountRejectBody, CountSessionCreate, InventoryCountCreate, InventoryCountResponse, InventoryTransferCreate
from services.count_service import approve_count, count_history, count_suggestions, reject_count, submit_counts
from services.inventory_service import InventoryService

router = APIRouter(prefix="/inventory", tags=["Inventory"])


def _count_notes(reason: str | None) -> str:
    return f"Physical count adjustment: {reason}" if reason else "Physical count adjustment"


async def _same_count_request(db: AsyncSession, prior: InventoryCount, payload: InventoryCountCreate, user: User) -> bool:
    if (prior.user_id, prior.product_id, prior.warehouse_id, Decimal(str(prior.observed_quantity))) != (
        user.id, payload.product_id, payload.warehouse_id, payload.observed_quantity,
    ):
        return False
    if prior.request_fingerprint:
        return prior.request_fingerprint == request_fingerprint(payload)
    if not prior.difference:
        return True
    movement = (await db.execute(select(InventoryTransaction).where(
        InventoryTransaction.request_id == payload.request_id,
    ))).scalar_one_or_none()
    return bool(movement and movement.request_fingerprint == request_fingerprint(payload, exclude={"reason"})
                and movement.notes == _count_notes(payload.reason))


@router.get("/counts/latest", response_model=InventoryCountResponse | None)
async def latest_count(
    product_id: UUID, warehouse_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_inventory_access),
):
    return (await db.execute(select(InventoryCount).where(
        InventoryCount.product_id == product_id,
        InventoryCount.warehouse_id == warehouse_id,
    ).order_by(InventoryCount.created_at.desc(), InventoryCount.id.desc()).limit(1))).scalar_one_or_none()


@router.post("/transfers", dependencies=[Depends(require_full_mode)])
async def transfer_stock(
    payload: InventoryTransferCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    if payload.source_warehouse_id == payload.target_warehouse_id:
        raise HTTPException(status_code=400, detail="Source and destination must differ")
    fingerprint = request_fingerprint(payload)
    prior = (await db.execute(select(InventoryTransaction).where(
        InventoryTransaction.request_id == payload.request_id,
    ))).scalar_one_or_none()
    if prior is not None:
        if prior.request_fingerprint != fingerprint or prior.user_id != user.id:
            raise HTTPException(status_code=409, detail="Request ID was already used for a different transfer")
        return {"transfer_id": payload.request_id, "quantity": payload.quantity}

    product = (await db.execute(select(Product.id).where(Product.id == payload.product_id, Product.is_deleted == False).with_for_update())).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    warehouses = (await db.execute(select(Warehouse).where(
        Warehouse.id.in_([payload.source_warehouse_id, payload.target_warehouse_id]),
        Warehouse.is_active == True,
    ).order_by(Warehouse.id).with_for_update())).scalars().all()
    if len(warehouses) != 2:
        raise HTTPException(status_code=404, detail="Active warehouse not found")
    balances = (await db.execute(select(InventoryBalance).where(
        InventoryBalance.product_id == payload.product_id,
        InventoryBalance.warehouse_id.in_([payload.source_warehouse_id, payload.target_warehouse_id]),
    ).order_by(InventoryBalance.warehouse_id).with_for_update())).scalars().all()
    by_warehouse = {balance.warehouse_id: balance for balance in balances}
    source = by_warehouse.get(payload.source_warehouse_id)
    if source is None or Decimal(str(source.current_stock)) < payload.quantity:
        raise HTTPException(status_code=400, detail="Insufficient source stock")
    target = by_warehouse.get(payload.target_warehouse_id)
    if target is None:
        target = InventoryBalance(product_id=payload.product_id, warehouse_id=payload.target_warehouse_id, current_stock=0)
        db.add(target)
        await db.flush()
    InventoryService.record_movement(
        db, source, -payload.quantity, user.id, TransactionTypeEnum.TRANSFER,
        reference_document=str(payload.request_id), notes="Transfer out",
        request_id=payload.request_id, request_fingerprint=fingerprint,
    )
    InventoryService.record_movement(
        db, target, payload.quantity, user.id, TransactionTypeEnum.TRANSFER,
        reference_document=str(payload.request_id), notes="Transfer in",
    )
    db.add(AuditLog(user_id=user.id, action="TRANSFER_STOCK", entity_type="Product", entity_id=str(payload.product_id),
                    new_value={"quantity": str(payload.quantity), "source": str(payload.source_warehouse_id), "target": str(payload.target_warehouse_id)}))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(InventoryTransaction).where(InventoryTransaction.request_id == payload.request_id))).scalar_one_or_none()
        if prior is None or prior.request_fingerprint != fingerprint or prior.user_id != user.id:
            raise HTTPException(status_code=409, detail="Transfer could not be completed")
    return {"transfer_id": payload.request_id, "quantity": payload.quantity}


@router.post("/counts", response_model=InventoryCountResponse)
async def count_stock(
    payload: InventoryCountCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    prior = (await db.execute(select(InventoryCount).where(InventoryCount.id == payload.request_id))).scalar_one_or_none()
    if prior is not None:
        if not await _same_count_request(db, prior, payload, user):
            raise HTTPException(status_code=409, detail="Request ID was already used for a different count")
        return prior
    try:
        counts = await submit_counts(db, user, payload.warehouse_id, [payload],
                                     single_id=payload.request_id, fingerprint=request_fingerprint(payload))
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(InventoryCount).where(InventoryCount.id == payload.request_id))).scalar_one_or_none()
        if prior is None or not await _same_count_request(db, prior, payload, user):
            raise HTTPException(status_code=409, detail="Count could not be completed")
        return prior
    return counts[0]


@router.post("/count-sessions")
async def create_count_session(
    payload: CountSessionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    fingerprint = request_fingerprint(payload)
    existing = (await db.execute(select(InventoryCountSession).where(
        InventoryCountSession.id == payload.request_id))).scalar_one_or_none()
    if existing is not None:
        if existing.user_id != user.id or existing.request_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="Request ID was already used for different count data")
        counts = (await db.execute(select(InventoryCount).where(
            InventoryCount.session_id == payload.request_id).order_by(InventoryCount.created_at, InventoryCount.id))).scalars().all()
        return {"session_id": payload.request_id, "items": counts}
    try:
        counts = await submit_counts(db, user, payload.warehouse_id, payload.lines,
                                     session_id=payload.request_id, fingerprint=fingerprint)
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(select(InventoryCountSession).where(
            InventoryCountSession.id == payload.request_id))).scalar_one_or_none()
        if existing is None or existing.user_id != user.id or existing.request_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="Count session could not be completed")
        counts = (await db.execute(select(InventoryCount).where(
            InventoryCount.session_id == payload.request_id).order_by(InventoryCount.created_at, InventoryCount.id))).scalars().all()
    return {"session_id": payload.request_id, "items": counts}


@router.get("/counts/history")
async def list_count_history(
    status: str | None = None, limit: int = 50, offset: int = 0,
    session_id: UUID | None = None, count_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_inventory_access),
):
    if status not in (None, "PENDING", "APPROVED", "REJECTED"):
        raise HTTPException(status_code=422, detail="Invalid count status")
    if not 1 <= limit <= 100 or offset < 0:
        raise HTTPException(status_code=422, detail="Invalid pagination")
    return await count_history(db, status=status, limit=limit, offset=offset,
                               session_id=session_id, count_id=count_id)


@router.get("/counts/suggestions")
async def list_count_suggestions(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_inventory_access),
):
    return await count_suggestions(db)


@router.post("/counts/{count_id}/approve", response_model=InventoryCountResponse)
async def approve_count_request(
    count_id: UUID, db: AsyncSession = Depends(get_db),
    manager: User = Depends(require_admin),
):
    return await approve_count(db, count_id, manager)


@router.post("/counts/{count_id}/reject", response_model=InventoryCountResponse)
async def reject_count_request(
    count_id: UUID, payload: CountRejectBody,
    db: AsyncSession = Depends(get_db), manager: User = Depends(require_admin),
):
    return await reject_count(db, count_id, manager, payload.reason)
