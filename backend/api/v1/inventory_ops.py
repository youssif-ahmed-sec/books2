from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_inventory_access
from core.feature_flags import require_full_mode
from core.idempotency import request_fingerprint
from database import get_db
from models.inventory import InventoryBalance, InventoryCount, InventoryTransaction, TransactionTypeEnum, Warehouse
from models.product import Product
from models.user import AuditLog, User
from schemas.inventory import InventoryCountCreate, InventoryCountResponse, InventoryTransferCreate
from services.inventory_service import InventoryService

router = APIRouter(prefix="/inventory", tags=["Inventory"])


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
        if (prior.user_id, prior.product_id, prior.warehouse_id, Decimal(str(prior.observed_quantity))) != (
            user.id, payload.product_id, payload.warehouse_id, payload.observed_quantity,
        ):
            raise HTTPException(status_code=409, detail="Request ID was already used for a different count")
        return prior
    product = (await db.execute(select(Product.id).where(Product.id == payload.product_id, Product.is_deleted == False).with_for_update())).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    warehouse = (await db.execute(select(Warehouse).where(
        Warehouse.id == payload.warehouse_id, Warehouse.is_active == True,
    ).with_for_update())).scalar_one_or_none()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Active warehouse not found")
    balance = (await db.execute(select(InventoryBalance).where(
        InventoryBalance.product_id == payload.product_id,
        InventoryBalance.warehouse_id == payload.warehouse_id,
    ).with_for_update())).scalar_one_or_none()
    if balance is None:
        balance = InventoryBalance(product_id=payload.product_id, warehouse_id=payload.warehouse_id, current_stock=0)
        db.add(balance)
        await db.flush()
    expected = Decimal(str(balance.current_stock))
    difference = payload.observed_quantity - expected
    count = InventoryCount(
        id=payload.request_id, product_id=payload.product_id, warehouse_id=payload.warehouse_id,
        user_id=user.id, expected_quantity=expected, observed_quantity=payload.observed_quantity,
        difference=difference,
    )
    db.add(count)
    if difference:
        InventoryService.record_movement(
            db, balance, difference, user.id, TransactionTypeEnum.COUNTING,
            reference_document=str(payload.request_id), notes="Physical count adjustment",
            request_id=payload.request_id, request_fingerprint=request_fingerprint(payload),
        )
    db.add(AuditLog(user_id=user.id, action="COUNT_STOCK", entity_type="Product", entity_id=str(payload.product_id),
                    old_value={"expected": str(expected)}, new_value={"observed": str(payload.observed_quantity)}))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(InventoryCount).where(InventoryCount.id == payload.request_id))).scalar_one_or_none()
        if prior is None or (prior.user_id, prior.product_id, prior.warehouse_id, Decimal(str(prior.observed_quantity))) != (
            user.id, payload.product_id, payload.warehouse_id, payload.observed_quantity,
        ):
            raise HTTPException(status_code=409, detail="Count could not be completed")
        return prior
    await db.refresh(count)
    return count
