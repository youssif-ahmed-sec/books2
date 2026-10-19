"""Physical counts update stock immediately for admins or after manager approval."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid5

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from models.inventory import InventoryBalance, InventoryCount, InventoryCountSession, TransactionTypeEnum, Warehouse
from models.product import Product
from models.user import AuditLog, RoleEnum, User
from services.inventory_service import InventoryService
from services.notification_service import notify_low_stock_crossing, notify_roles, notify_user


def _quantity(value) -> Decimal:
    return Decimal(str(value or 0))


async def _locked_count_context(db: AsyncSession, product_ids: list[UUID], warehouse_id: UUID):
    products = (await db.execute(select(Product).where(
        Product.id.in_(product_ids), Product.is_deleted == False, Product.is_bundle == False,
    ).order_by(Product.id).with_for_update())).scalars().all()
    if len(products) != len(product_ids):
        raise HTTPException(status_code=404, detail="One or more products were not found")
    warehouse = (await db.execute(select(Warehouse).where(
        Warehouse.id == warehouse_id, Warehouse.is_active == True,
    ).with_for_update())).scalar_one_or_none()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Active warehouse not found")
    inactive = (await db.execute(select(InventoryBalance.product_id).join(
        Warehouse, InventoryBalance.warehouse_id == Warehouse.id,
    ).where(
        InventoryBalance.product_id.in_(product_ids),
        InventoryBalance.current_stock > 0, Warehouse.is_active.is_not(True),
    ).limit(1))).scalar_one_or_none()
    if inactive is not None:
        raise HTTPException(status_code=409, detail="Product has stock in an inactive warehouse; reconcile warehouses before counting")
    balances = (await db.execute(select(InventoryBalance).where(
        InventoryBalance.product_id.in_(product_ids), InventoryBalance.warehouse_id == warehouse_id,
    ).order_by(InventoryBalance.product_id).with_for_update())).scalars().all()
    return {product.id: product for product in products}, {row.product_id: row for row in balances}


async def _apply_count_adjustment(db: AsyncSession, count: InventoryCount, product: Product,
                                  balance: InventoryBalance | None, manager: User, *, direct: bool) -> None:
    if balance is None:
        balance = InventoryBalance(product_id=count.product_id, warehouse_id=count.warehouse_id, current_stock=0)
        db.add(balance)
        await db.flush()
    total_before = (await db.execute(select(func.coalesce(func.sum(InventoryBalance.current_stock), 0)).where(
        InventoryBalance.product_id == count.product_id))).scalar_one()
    InventoryService.record_movement(
        db, balance, _quantity(count.difference), manager.id, TransactionTypeEnum.COUNTING,
        unit_cost=count.unit_cost, reference_document=str(count.id),
        notes=f"Physical count adjustment: {count.reason}", request_id=count.id,
        request_fingerprint=count.request_fingerprint,
    )
    count.status = "APPROVED"
    count.reviewed_by = manager.id
    count.reviewed_at = datetime.now(timezone.utc)
    db.add(AuditLog(user_id=manager.id, action="ADMIN_DIRECT_COUNT" if direct else "APPROVE_COUNT",
                    entity_type="InventoryCount", entity_id=str(count.id),
                    old_value={"expected": str(count.expected_quantity)},
                    new_value={"observed": str(count.observed_quantity), "reason": count.reason}))
    if not direct:
        notify_user(db, count.user_id, kind="count_approved", title="تم اعتماد فرق الجرد",
                    message=f"{product.name_ar} · أصبح الرصيد {count.observed_quantity}",
                    href=f"/stock-operations?count={count.id}")
    await notify_low_stock_crossing(db, product, _quantity(total_before),
                                    _quantity(total_before) + _quantity(count.difference))


async def submit_counts(db: AsyncSession, user: User, warehouse_id: UUID, lines, *,
                        session_id: UUID | None = None, fingerprint: str | None = None,
                        single_id: UUID | None = None) -> list[InventoryCount]:
    product_ids = [line.product_id for line in lines]
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(status_code=422, detail="Combine repeated products into one count line")
    products, balances = await _locked_count_context(db, product_ids, warehouse_id)
    if session_id is not None:
        db.add(InventoryCountSession(id=session_id, warehouse_id=warehouse_id,
                                     user_id=user.id, request_fingerprint=fingerprint))
        await db.flush()
    counts = []
    pending = 0
    is_admin = user.role == RoleEnum.ADMIN
    for line in lines:
        product = products[line.product_id]
        expected = _quantity(balances.get(line.product_id).current_stock) if line.product_id in balances else Decimal("0")
        if hasattr(line, "expected_quantity") and line.expected_quantity != expected:
            raise HTTPException(status_code=409, detail=f"Stock changed after counting: {product.name_ar}. Count this product again")
        difference = line.observed_quantity - expected
        reason = (line.reason or "").strip() or None
        if difference and not reason:
            raise HTTPException(status_code=422, detail=f"Reason is required for count difference: {product.name_ar}")
        count_id = single_id or uuid5(session_id, str(line.product_id))
        count = InventoryCount(
            id=count_id, session_id=session_id, product_id=line.product_id,
            warehouse_id=warehouse_id, user_id=user.id,
            expected_quantity=expected, observed_quantity=line.observed_quantity,
            difference=difference, reason=reason,
            status="PENDING" if difference and not is_admin else "APPROVED",
            request_fingerprint=fingerprint,
            unit_cost=_quantity(product.cost),
        )
        db.add(count)
        counts.append(count)
        if difference and is_admin:
            await _apply_count_adjustment(db, count, product, balances.get(line.product_id), user, direct=True)
        elif difference:
            pending += 1
        db.add(AuditLog(user_id=user.id, action="SUBMIT_COUNT", entity_type="InventoryCount",
                        entity_id=str(count_id), old_value={"expected": str(expected)},
                        new_value={"observed": str(line.observed_quantity), "reason": reason,
                                   "status": count.status}))
    if pending:
        href = f"/count-approvals?session={session_id}" if session_id else f"/count-approvals?count={single_id}"
        await notify_roles(db, (RoleEnum.ADMIN,), kind="count_approval", title="جرد ينتظر موافقتك",
                           message=f"{pending} صنف به فرق جرد يحتاج قرارًا منك", href=href)
    await db.commit()
    return counts


async def approve_count(db: AsyncSession, count_id: UUID, manager: User) -> InventoryCount:
    initial = (await db.execute(select(InventoryCount.product_id).where(
        InventoryCount.id == count_id))).scalar_one_or_none()
    if initial is None:
        raise HTTPException(status_code=404, detail="Count not found")
    product = (await db.execute(select(Product).where(
        Product.id == initial, Product.is_deleted == False, Product.is_bundle == False,
    ).with_for_update())).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=409, detail="Product is no longer available")
    count = (await db.execute(select(InventoryCount).where(
        InventoryCount.id == count_id,
    ).with_for_update())).scalar_one()
    if count.status == "APPROVED":
        return count
    if count.status != "PENDING":
        raise HTTPException(status_code=409, detail="Count is not pending approval")
    warehouse = (await db.execute(select(Warehouse).where(
        Warehouse.id == count.warehouse_id, Warehouse.is_active == True,
    ).with_for_update())).scalar_one_or_none()
    if warehouse is None:
        raise HTTPException(status_code=409, detail="Warehouse is no longer active")
    inactive = (await db.execute(select(InventoryBalance.id).join(
        Warehouse, InventoryBalance.warehouse_id == Warehouse.id,
    ).where(InventoryBalance.product_id == count.product_id,
            InventoryBalance.current_stock > 0, Warehouse.is_active.is_not(True)).limit(1))).scalar_one_or_none()
    if inactive is not None:
        raise HTTPException(status_code=409, detail="Product has stock in an inactive warehouse")
    balance = (await db.execute(select(InventoryBalance).where(
        InventoryBalance.product_id == count.product_id,
        InventoryBalance.warehouse_id == count.warehouse_id,
    ).with_for_update())).scalar_one_or_none()
    actual = _quantity(balance.current_stock) if balance else Decimal("0")
    if actual != _quantity(count.expected_quantity):
        raise HTTPException(status_code=409, detail="Stock changed after counting; reject this count and count the product again")
    await _apply_count_adjustment(db, count, product, balance, manager, direct=False)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Stock changed while approving; recount this product")
    await db.refresh(count)
    return count


async def reject_count(db: AsyncSession, count_id: UUID, manager: User, reason: str) -> InventoryCount:
    count = (await db.execute(select(InventoryCount).where(
        InventoryCount.id == count_id,
    ).with_for_update())).scalar_one_or_none()
    if count is None:
        raise HTTPException(status_code=404, detail="Count not found")
    if count.status == "REJECTED":
        return count
    if count.status != "PENDING":
        raise HTTPException(status_code=409, detail="Count is not pending approval")
    product_name = (await db.execute(select(Product.name_ar).where(
        Product.id == count.product_id))).scalar_one_or_none() or "المنتج"
    count.status = "REJECTED"
    count.reviewed_by = manager.id
    count.reviewed_at = datetime.now(timezone.utc)
    count.rejection_reason = reason
    db.add(AuditLog(user_id=manager.id, action="REJECT_COUNT", entity_type="InventoryCount",
                    entity_id=str(count.id), new_value={"reason": reason}))
    notify_user(db, count.user_id, kind="count_rejected", title="رُفض فرق الجرد",
                message=f"{product_name} · {reason[:350]}", href=f"/stock-operations?count={count.id}")
    await db.commit()
    await db.refresh(count)
    return count


async def count_history(db: AsyncSession, *, status: str | None, limit: int, offset: int,
                        session_id: UUID | None = None, count_id: UUID | None = None) -> dict:
    counter = aliased(User)
    reviewer = aliased(User)
    conditions = [InventoryCount.status == status] if status else []
    if session_id is not None:
        conditions.append(InventoryCount.session_id == session_id)
    if count_id is not None:
        conditions.append(InventoryCount.id == count_id)
    total = (await db.execute(select(func.count(InventoryCount.id)).where(*conditions))).scalar_one()
    rows = (await db.execute(select(InventoryCount, Product.name_ar, Product.sku,
                                    counter.username, counter.email, reviewer.username, reviewer.email)
        .join(Product, Product.id == InventoryCount.product_id)
        .join(counter, counter.id == InventoryCount.user_id)
        .outerjoin(reviewer, reviewer.id == InventoryCount.reviewed_by)
        .where(*conditions)
        .order_by(InventoryCount.created_at.desc(), InventoryCount.id.desc())
        .offset(offset).limit(limit))).all()
    return {"total": total, "items": [{
        "id": str(row.id), "session_id": str(row.session_id) if row.session_id else None,
        "product_id": str(row.product_id), "product_name": name, "sku": sku,
        "warehouse_id": str(row.warehouse_id), "counter": username or email or "—",
        "reviewer": reviewer_name or reviewer_email,
        "expected_quantity": row.expected_quantity, "observed_quantity": row.observed_quantity,
        "difference": row.difference, "unit_cost": row.unit_cost,
        "difference_value": _quantity(row.difference) * _quantity(row.unit_cost) if row.unit_cost is not None else None,
        "reason": row.reason, "status": row.status, "rejection_reason": row.rejection_reason,
        "created_at": row.created_at, "reviewed_at": row.reviewed_at,
    } for row, name, sku, username, email, reviewer_name, reviewer_email in rows]}


async def count_suggestions(db: AsyncSession, *, limit: int = 30) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    recent_cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    latest = select(InventoryCount.product_id.label("product_id"),
                    func.max(InventoryCount.created_at).label("last_counted_at")).where(
        InventoryCount.status != "REJECTED").group_by(InventoryCount.product_id).subquery()
    variances = select(InventoryCount.product_id.label("product_id"),
                       func.count(InventoryCount.id).label("variance_count")).where(
        InventoryCount.difference != 0, InventoryCount.created_at >= recent_cutoff,
        InventoryCount.status != "REJECTED").group_by(InventoryCount.product_id).subquery()
    rows = (await db.execute(select(Product.id, Product.name_ar, Product.sku,
                                    latest.c.last_counted_at, variances.c.variance_count)
        .outerjoin(latest, latest.c.product_id == Product.id)
        .outerjoin(variances, variances.c.product_id == Product.id)
        .where(Product.is_deleted == False, Product.is_active == True, Product.is_bundle == False,
               (latest.c.last_counted_at.is_(None)) | (latest.c.last_counted_at < cutoff)
               | (variances.c.variance_count >= 2))
        .order_by(variances.c.variance_count.desc().nullslast(),
                  latest.c.last_counted_at.asc().nullsfirst(), Product.name_ar)
        .limit(limit))).all()
    return [{"product_id": str(product_id), "product_name": name, "sku": sku,
             "last_counted_at": last_counted_at, "recent_variances": variance_count or 0}
            for product_id, name, sku, last_counted_at, variance_count in rows]
