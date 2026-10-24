from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_inventory_access
from core.idempotency import request_fingerprint
from database import get_db
from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum, Warehouse
from models.product import Product, ProductSupplierLink, Supplier
from models.purchase import PurchaseOrder
from models.user import AuditLog, RoleEnum, User
from schemas.purchase import PurchaseOrderResponse, PurchaseReceive, PurchaseRequestCreate
from services.inventory_service import InventoryService
from services.notification_service import notify_roles, notify_user

router = APIRouter(prefix="/purchases", tags=["Purchases"])


@router.get("", response_model=list[PurchaseOrderResponse])
async def list_purchase_orders(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_inventory_access),
):
    return (await db.execute(select(PurchaseOrder).order_by(PurchaseOrder.created_at.desc()))).scalars().all()


@router.post("", response_model=PurchaseOrderResponse, status_code=status.HTTP_201_CREATED)
async def request_purchase(
    payload: PurchaseRequestCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    product = (await db.execute(select(Product).where(
        Product.id == payload.product_id, Product.is_deleted == False, Product.is_bundle == False,
    ).with_for_update())).scalar_one_or_none()
    supplier = (await db.execute(select(Supplier).where(Supplier.id == payload.supplier_id, Supplier.is_deleted == False))).scalar_one_or_none()
    if product is None or supplier is None:
        raise HTTPException(status_code=404, detail="Active product or supplier not found")
    order = PurchaseOrder(
        product_id=payload.product_id, supplier_id=payload.supplier_id,
        quantity=payload.quantity, received_quantity=0, status="REQUESTED", requested_by=user.id,
    )
    db.add(order)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="REQUEST_PURCHASE", entity_type="PurchaseOrder", entity_id=str(order.id)))
    await notify_roles(db, (RoleEnum.ADMIN,), kind="purchase_request",
                       title="طلب شراء جديد", message=f"{product.name_ar} · كمية {payload.quantity}", href="/purchases")
    await db.commit()
    await db.refresh(order)
    return order


@router.post("/{purchase_id}/approve", response_model=PurchaseOrderResponse)
async def approve_purchase(
    purchase_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    order = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_id).with_for_update())).scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Purchase request not found")
    if order.status != "REQUESTED":
        raise HTTPException(status_code=409, detail="Only requested purchases can be approved")
    order.status = "APPROVED"
    order.approved_by = user.id
    db.add(AuditLog(user_id=user.id, action="APPROVE_PURCHASE", entity_type="PurchaseOrder", entity_id=str(order.id)))
    notify_user(db, order.requested_by, kind="purchase_approved", title="تمت الموافقة على طلب الشراء",
                message="يمكن متابعة الطلب من صفحة المشتريات.", href="/purchases")
    await db.commit()
    await db.refresh(order)
    return order


@router.post("/{purchase_id}/reject", response_model=PurchaseOrderResponse)
async def reject_purchase(
    purchase_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    order = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_id).with_for_update())).scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Purchase request not found")
    if order.status != "REQUESTED":
        raise HTTPException(status_code=409, detail="Only requested purchases can be rejected")
    order.status = "REJECTED"
    db.add(AuditLog(user_id=user.id, action="REJECT_PURCHASE", entity_type="PurchaseOrder", entity_id=str(order.id)))
    notify_user(db, order.requested_by, kind="purchase_rejected", title="تم رفض طلب الشراء",
                message="راجع حالة الطلب في صفحة المشتريات.", href="/purchases")
    await db.commit()
    await db.refresh(order)
    return order


@router.post("/{purchase_id}/place", response_model=PurchaseOrderResponse)
async def place_purchase_order(
    purchase_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    order = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_id).with_for_update())).scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Purchase request not found")
    if order.status != "APPROVED":
        raise HTTPException(status_code=409, detail="Purchase needs admin approval before ordering")
    order.status = "ORDERED"
    order.ordered_at = datetime.now(timezone.utc)
    db.add(AuditLog(user_id=user.id, action="PLACE_PURCHASE_ORDER", entity_type="PurchaseOrder", entity_id=str(order.id)))
    await db.commit()
    await db.refresh(order)
    return order


@router.post("/{purchase_id}/receive", response_model=PurchaseOrderResponse)
async def receive_purchase(
    purchase_id: UUID,
    payload: PurchaseReceive,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    fingerprint = request_fingerprint(payload)
    prior = (await db.execute(select(InventoryTransaction).where(
        InventoryTransaction.request_id == payload.request_id,
    ))).scalar_one_or_none()
    if prior is not None:
        if prior.request_fingerprint != fingerprint or prior.reference_document != str(purchase_id) or prior.user_id != user.id:
            raise HTTPException(status_code=409, detail="Request ID was already used for a different receipt")
        return (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_id))).scalar_one()

    order = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_id).with_for_update())).scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.status not in ("ORDERED", "PARTIALLY_RECEIVED"):
        raise HTTPException(status_code=409, detail="Purchase order is not ready for receiving")
    next_quantity = Decimal(str(order.received_quantity or 0)) + payload.quantity
    if next_quantity > Decimal(str(order.quantity)):
        raise HTTPException(status_code=400, detail="Receipt exceeds ordered quantity")
    product = (await db.execute(select(Product).where(
        Product.id == order.product_id, Product.is_deleted == False, Product.is_bundle == False,
    ).with_for_update())).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=409, detail="Product is no longer active for receiving")
    if (await db.execute(select(ProductSupplierLink.id).where(
        ProductSupplierLink.product_id == order.product_id,
        ProductSupplierLink.supplier_id == order.supplier_id,
    ))).scalar_one_or_none() is None:
        db.add(ProductSupplierLink(product_id=order.product_id, supplier_id=order.supplier_id))
    warehouse = (await db.execute(select(Warehouse).where(
        Warehouse.id == payload.warehouse_id, Warehouse.is_active == True,
    ).with_for_update())).scalar_one_or_none()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Active warehouse not found")
    balance = (await db.execute(select(InventoryBalance).where(
        InventoryBalance.product_id == order.product_id,
        InventoryBalance.warehouse_id == payload.warehouse_id,
    ).with_for_update())).scalar_one_or_none()
    if balance is None:
        balance = InventoryBalance(product_id=order.product_id, warehouse_id=payload.warehouse_id, current_stock=0)
        db.add(balance)
        await db.flush()
    InventoryService.record_movement(
        db, balance, payload.quantity, user.id, TransactionTypeEnum.RECEIVING,
        supplier_id=order.supplier_id,
        reference_document=str(order.id), notes="Purchase order receipt",
        request_id=payload.request_id, request_fingerprint=fingerprint,
    )
    order.received_quantity = next_quantity
    order.status = "RECEIVED" if next_quantity == Decimal(str(order.quantity)) else "PARTIALLY_RECEIVED"
    db.add(AuditLog(user_id=user.id, action="RECEIVE_PURCHASE", entity_type="PurchaseOrder", entity_id=str(order.id),
                    new_value={"quantity": str(payload.quantity)}))
    await notify_roles(db, (RoleEnum.ADMIN,), kind="stock_received", title="استلام من أمر شراء",
                       message=f"{product.name_ar} · كمية {payload.quantity}", href="/purchases")
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(InventoryTransaction).where(
            InventoryTransaction.request_id == payload.request_id,
        ))).scalar_one_or_none()
        if prior is None or prior.request_fingerprint != fingerprint or prior.reference_document != str(purchase_id) or prior.user_id != user.id:
            raise HTTPException(status_code=409, detail="Receipt could not be completed")
        return (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_id))).scalar_one()
    await db.refresh(order)
    return order
