import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_inventory_access
from database import get_db
from models.product import Product
from models.product_approval import ProductApproval
from models.user import RoleEnum, User
from schemas.product import ProductUpdate
from services.notification_service import notify_roles, notify_user
from services.product_service import ProductService

router = APIRouter(prefix="/product-approvals", tags=["Product approvals"])


class RequestInput(BaseModel):
    product_id: UUID
    action: str
    proposed: ProductUpdate | None = None
    model_config = ConfigDict(extra="forbid")


class RejectInput(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


def product_snapshot(product: Product) -> dict:
    fields = ("sku", "barcode", "name_en", "name_ar", "category_id", "subcategory_id",
              "brand_id", "supplier_id", "base_unit", "cost", "tax_rate", "min_stock_level",
              "max_stock_level", "description", "image_url", "warehouse_location", "is_bundle", "is_active")
    return {
        "fields": {name: str(value) if value is not None else None
                   for name in fields for value in [getattr(product, name)]},
        "units": sorted([{
            "id": str(unit.id), "unit_name": unit.unit_name,
            "conversion_factor": str(unit.conversion_factor), "barcode": unit.barcode,
            "prices": sorted([{"level": str(price.price_level.value), "price": str(price.price)}
                              for price in unit.prices if not price.is_deleted], key=lambda row: row["level"]),
        } for unit in product.units if not unit.is_deleted], key=lambda row: row["id"]),
        "components": sorted([{
            "id": str(component.component_id), "quantity": str(component.quantity),
            "unit_id": str(component.unit_id) if component.unit_id else None,
            "price_level": str(component.price_level.value) if component.price_level else None,
        } for component in product.bundle_components if not component.is_deleted], key=lambda row: row["id"]),
    }


def snapshot_hash(snapshot: dict) -> str:
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def present(row: ProductApproval, requester: str | None = None) -> dict:
    return {
        "id": str(row.id), "product_id": str(row.product_id), "product_name": row.product_name,
        "action": row.action, "status": row.status, "baseline": row.baseline,
        "proposed": row.proposed, "requested_by": str(row.requested_by), "requester": requester,
        "created_at": row.created_at, "reviewed_at": row.reviewed_at,
        "rejection_reason": row.rejection_reason,
    }


@router.get("")
async def list_requests(
    status: str | None = Query(None), limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access),
):
    if status not in (None, "PENDING", "APPROVED", "REJECTED"):
        raise HTTPException(status_code=422, detail="Invalid status")
    query = select(ProductApproval, User).join(User, User.id == ProductApproval.requested_by)
    if user.role != RoleEnum.ADMIN:
        query = query.where(ProductApproval.requested_by == user.id)
    if status:
        query = query.where(ProductApproval.status == status)
    rows = (await db.execute(query.order_by(
        case((ProductApproval.status == "PENDING", 0), else_=1),
        ProductApproval.created_at.desc(), ProductApproval.id.desc(),
    ).offset(offset).limit(limit))).all()
    return [present(row, requester.full_name or requester.username or requester.email) for row, requester in rows]


@router.get("/{request_id}")
async def get_request(
    request_id: UUID, db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    row = (await db.execute(select(ProductApproval).where(ProductApproval.id == request_id))).scalar_one_or_none()
    if row is None or (user.role != RoleEnum.ADMIN and row.requested_by != user.id):
        raise HTTPException(status_code=404, detail="الطلب غير موجود.")
    return present(row)


@router.post("", status_code=201)
async def request_change(
    payload: RequestInput, db: AsyncSession = Depends(get_db),
    user: User = Depends(require_inventory_access),
):
    if user.role != RoleEnum.INVENTORY_CONTROLLER:
        raise HTTPException(status_code=403, detail="المدير يعدّل المنتج مباشرة.")
    if payload.action not in ("UPDATE", "DELETE"):
        raise HTTPException(status_code=422, detail="Invalid action")
    if payload.action == "UPDATE" and (payload.proposed is None or not payload.proposed.model_fields_set):
        raise HTTPException(status_code=422, detail="Proposed changes are required")
    if payload.action == "DELETE" and payload.proposed is not None:
        raise HTTPException(status_code=422, detail="Delete request cannot include changes")
    product = await ProductService.get_product(db, payload.product_id)
    if product is None or product.is_bundle:
        raise HTTPException(status_code=404, detail="المنتج غير موجود.")
    baseline = product_snapshot(product)
    request = ProductApproval(
        product_id=product.id, requested_by=user.id, action=payload.action,
        product_name=product.name_ar, baseline=baseline, baseline_hash=snapshot_hash(baseline),
        proposed=payload.proposed.model_dump(mode="json", exclude_unset=True) if payload.proposed else None,
    )
    try:
        db.add(request)
        await db.flush()
        await notify_roles(db, (RoleEnum.ADMIN,), kind="product_approval",
                           title="طلب تعديل منتج" if payload.action == "UPDATE" else "طلب حذف منتج",
                           message=product.name_ar, href=f"/product-approvals?request={request.id}")
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="يوجد طلب معلّق لهذا المنتج. انتظر قرار المدير أولًا.") from exc
    return present(request)


@router.post("/{request_id}/approve")
async def approve_request(
    request_id: UUID, db: AsyncSession = Depends(get_db), manager: User = Depends(require_admin),
):
    row = (await db.execute(select(ProductApproval).where(ProductApproval.id == request_id)
                            .with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.status != "PENDING":
        raise HTTPException(status_code=409, detail="Request was already reviewed")
    product = (await db.execute(select(Product).where(Product.id == row.product_id)
                                .with_for_update())).scalar_one_or_none()
    if product is None or product.is_deleted:
        raise HTTPException(status_code=409, detail="Product is no longer available")
    current = await ProductService.get_product(db, row.product_id)
    if snapshot_hash(product_snapshot(current)) != row.baseline_hash:
        raise HTTPException(status_code=409, detail="تغيّر المنتج بعد تقديم الطلب. ارفض الطلب ليُرسل أمين المخزن طلبًا جديدًا.")
    row.status = "APPROVED"
    row.reviewed_by = manager.id
    row.reviewed_at = datetime.now(timezone.utc)
    notify_user(db, row.requested_by, kind="product_approved", title="تمت الموافقة على طلب المنتج",
                message=row.product_name, href="/product-approvals")
    try:
        if row.action == "UPDATE":
            await ProductService.update_product(db, row.product_id, ProductUpdate.model_validate(row.proposed), manager.id)
        else:
            await ProductService.delete_product(db, row.product_id, manager.id)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return present(row)


@router.post("/{request_id}/reject")
async def reject_request(
    request_id: UUID, payload: RejectInput, db: AsyncSession = Depends(get_db),
    manager: User = Depends(require_admin),
):
    row = (await db.execute(select(ProductApproval).where(ProductApproval.id == request_id)
                            .with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.status != "PENDING":
        raise HTTPException(status_code=409, detail="Request was already reviewed")
    row.status = "REJECTED"
    row.reviewed_by = manager.id
    row.reviewed_at = datetime.now(timezone.utc)
    if len(payload.reason.strip()) < 3:
        raise HTTPException(status_code=422, detail="اكتب سبب الرفض من ٣ أحرف على الأقل.")
    row.rejection_reason = payload.reason.strip()
    notify_user(db, row.requested_by, kind="product_rejected", title="رُفض طلب المنتج",
                message=row.product_name, href="/product-approvals")
    await db.commit()
    return present(row)
