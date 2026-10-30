from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from uuid import UUID, uuid5
from typing import List

from models.inventory import InventoryTransaction, InventoryBalance, StockReceiptNumber, Warehouse, TransactionTypeEnum as MovementType
from models.product import Product, ProductUnit, ProductPrice, ProductSupplierLink, Supplier
from models.user import User, RoleEnum, AuditLog
from schemas.inventory import InventoryTransactionCreate, InventoryTransactionResponse, InventoryBalanceResponse, InventoryStatsResponse, InventoryTransactionRecentResponse, PaginatedInventoryTransactionResponse, StockReceiptCreate
from sqlalchemy import func, desc
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from core.dependencies import require_inventory_access, require_warehouse_access
from core.idempotency import request_fingerprint
from database import get_db
from services.inventory_service import InventoryService
from services.notification_service import notify_low_stock_crossing, notify_roles
from fastapi_cache.decorator import cache

router = APIRouter(prefix="/inventory", tags=["Inventory"])


async def _receipt_document(db: AsyncSession, receipt_id: UUID):
    reference = f"RCV-{receipt_id}"
    rows = (await db.execute(
        select(InventoryTransaction, Product.name_ar, Product.base_unit, Supplier.name, Warehouse.name)
        .join(Product, Product.id == InventoryTransaction.product_id)
        .join(Supplier, Supplier.id == InventoryTransaction.supplier_id)
        .join(Warehouse, Warehouse.id == InventoryTransaction.warehouse_id)
        .where(InventoryTransaction.reference_document == reference,
               InventoryTransaction.transaction_type == MovementType.RECEIVING)
        .order_by(InventoryTransaction.created_at, InventoryTransaction.id)
    )).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Stock receipt not found")
    first = rows[0][0]
    public_number = (await db.execute(select(StockReceiptNumber.public_number).where(
        StockReceiptNumber.id == receipt_id,
    ))).scalar_one()
    employee = (await db.execute(select(User.full_name, User.username, User.email).where(User.id == first.user_id))).one_or_none()
    return {
        "id": str(receipt_id), "public_number": public_number, "created_at": first.created_at,
        "employee_name": next((name for name in employee if name), "") if employee else "",
        "supplier_id": str(first.supplier_id), "supplier_name": rows[0][3],
        "warehouse_id": str(first.warehouse_id), "warehouse_name": rows[0][4],
        "supplier_document": first.notes,
        "lines": [{"product_id": str(tx.product_id), "product_name": product_name,
                   "unit_name": unit_name, "quantity": tx.quantity_changed,
                   "unit_cost": tx.unit_cost}
                  for tx, product_name, unit_name, _, _ in rows],
    }


@router.get("/receipts/{receipt_id}")
async def get_stock_receipt(
    receipt_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    return await _receipt_document(db, receipt_id)


@router.post("/receipts", status_code=status.HTTP_201_CREATED)
async def create_stock_receipt(
    payload: StockReceiptCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    product_ids = [line.product_id for line in payload.lines]
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(status_code=422, detail="Combine repeated products into one receipt line")
    fingerprint = request_fingerprint(payload)
    reference = f"RCV-{payload.request_id}"
    existing = (await db.execute(select(InventoryTransaction).where(
        InventoryTransaction.reference_document == reference,
        InventoryTransaction.transaction_type == MovementType.RECEIVING,
    ))).scalars().all()
    if existing:
        if len(existing) != len(payload.lines) or any(
            row.user_id != current_user.id or row.request_fingerprint != fingerprint
            for row in existing
        ):
            raise HTTPException(status_code=409, detail="Receipt ID was already used for different data")
        return await _receipt_document(db, payload.request_id)

    # Lock products in a stable order before warehouse/balances; all lines commit together.
    products = (await db.execute(select(Product).where(
        Product.id.in_(product_ids), Product.is_deleted == False, Product.is_bundle == False,
    ).order_by(Product.id).with_for_update())).scalars().all()
    if len(products) != len(product_ids):
        raise HTTPException(status_code=404, detail="One or more products were not found")
    warehouse = (await db.execute(select(Warehouse).where(
        Warehouse.id == payload.warehouse_id, Warehouse.is_active == True,
    ).with_for_update())).scalar_one_or_none()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Active warehouse not found")
    supplier = (await db.execute(select(Supplier).where(
        Supplier.id == payload.supplier_id, Supplier.is_deleted == False,
    ))).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=404, detail="Supplier not found")

    db.add(StockReceiptNumber(id=payload.request_id))
    for line in payload.lines:
        if (await db.execute(select(ProductSupplierLink.id).where(
            ProductSupplierLink.product_id == line.product_id,
            ProductSupplierLink.supplier_id == payload.supplier_id,
        ))).scalar_one_or_none() is None:
            db.add(ProductSupplierLink(product_id=line.product_id, supplier_id=payload.supplier_id))
        balance = (await db.execute(select(InventoryBalance).where(
            InventoryBalance.product_id == line.product_id,
            InventoryBalance.warehouse_id == payload.warehouse_id,
        ).with_for_update())).scalar_one_or_none()
        if balance is None:
            balance = InventoryBalance(product_id=line.product_id, warehouse_id=payload.warehouse_id, current_stock=0)
            db.add(balance)
            await db.flush()
        InventoryService.record_movement(
            db, balance, line.quantity, current_user.id, MovementType.RECEIVING,
            supplier_id=payload.supplier_id, unit_cost=line.unit_cost, reference_document=reference,
            notes=payload.supplier_document, request_id=uuid5(payload.request_id, str(line.product_id)),
            request_fingerprint=fingerprint,
        )
        db.add(AuditLog(user_id=current_user.id, action="RECEIVE_STOCK", entity_type="Product",
                        entity_id=str(line.product_id),
                        new_value={"quantity": str(line.quantity), "receipt_id": str(payload.request_id)}))
    await notify_roles(db, (RoleEnum.ADMIN,), kind="stock_received", title="توريد مخزون جديد",
                       message=f"تم تسجيل استلام مخزون: {payload.request_id}", href="/stock-operations")
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(select(InventoryTransaction).where(
            InventoryTransaction.reference_document == reference,
            InventoryTransaction.transaction_type == MovementType.RECEIVING,
        ))).scalars().all()
        if len(existing) != len(payload.lines) or any(
            row.user_id != current_user.id or row.request_fingerprint != fingerprint for row in existing
        ):
            raise HTTPException(status_code=409, detail="Receipt could not be completed")
    return await _receipt_document(db, payload.request_id)


@router.get("/warehouses")
async def get_active_warehouses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_warehouse_access),
):
    result = await db.execute(select(Warehouse).where(Warehouse.is_active == True).order_by(Warehouse.name))
    return [{"id": warehouse.id, "name": warehouse.name} for warehouse in result.scalars().all()]

@router.post("/transactions", response_model=InventoryTransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_inventory_transaction(
    transaction_in: InventoryTransactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Create a new inventory transaction and update the inventory balance.
    """
    quantity = transaction_in.quantity_changed
    if quantity == 0:
        raise HTTPException(status_code=400, detail="Quantity change must not be zero")
    if transaction_in.transaction_type == "Receiving" and quantity < 0:
        raise HTTPException(status_code=400, detail="Receiving quantity must be positive")
    if transaction_in.transaction_type == "Issuing" and quantity > 0:
        raise HTTPException(status_code=400, detail="Issuing quantity must be negative")
    is_receipt = transaction_in.transaction_type == "Receiving"
    if is_receipt and transaction_in.supplier_id is None:
        raise HTTPException(status_code=422, detail="Receiving requires supplier_id")
    if is_receipt and transaction_in.unit_cost is not None:
        raise HTTPException(status_code=422, detail="Set product cost in product edit, not receiving")
    if transaction_in.reference_document and transaction_in.reference_document.startswith("RCV-"):
        raise HTTPException(status_code=422, detail="RCV receipt numbers are assigned by the receiving workflow")
    if not is_receipt and (transaction_in.supplier_id is not None or transaction_in.unit_cost is not None):
        raise HTTPException(status_code=422, detail="Supplier and cost are only valid for Receiving")

    fingerprint = request_fingerprint(transaction_in)
    existing = (await db.execute(select(InventoryTransaction).where(
        InventoryTransaction.request_id == transaction_in.request_id
    ))).scalar_one_or_none()
    if existing is not None:
        if existing.user_id != current_user.id or existing.request_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="Request ID was already used for a different movement")
        return existing

    # Keep product archival and movements ordered by the same product lock.
    product_query = select(Product).where(
        Product.id == transaction_in.product_id,
        Product.is_deleted == False,
        Product.is_bundle == False,
    ).with_for_update()
    product = (await db.execute(product_query)).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    # Serializes first-time balance creation within a warehouse.
    warehouse_query = select(Warehouse).where(
        Warehouse.id == transaction_in.warehouse_id,
        Warehouse.is_active == True,
    ).with_for_update()
    warehouse = (await db.execute(warehouse_query)).scalar_one_or_none()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Active warehouse not found")

    if is_receipt:
        supplier_query = select(Supplier.id).where(
            Supplier.id == transaction_in.supplier_id,
            Supplier.is_deleted == False,
        )
        if (await db.execute(supplier_query)).scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Supplier not found")

    # Lock existing balance before checking and updating stock.
    balance_query = select(InventoryBalance).where(
        InventoryBalance.product_id == transaction_in.product_id,
        InventoryBalance.warehouse_id == transaction_in.warehouse_id
    ).with_for_update()
    result = await db.execute(balance_query)
    balance = result.scalar_one_or_none()
    
    if not balance and quantity < 0:
        raise HTTPException(status_code=400, detail="Insufficient stock")

    if not balance:
        # Create a new balance record if it doesn't exist
        balance = InventoryBalance(
            product_id=transaction_in.product_id,
            warehouse_id=transaction_in.warehouse_id,
            current_stock=0
        )
        db.add(balance)
        await db.flush()

    if balance.current_stock + quantity < 0:
        raise HTTPException(status_code=400, detail="Insufficient stock")
    stock_before = balance.current_stock
    new_transaction = InventoryService.record_movement(
        db, balance, quantity, current_user.id, transaction_in.transaction_type,
        supplier_id=transaction_in.supplier_id,
        unit_cost=transaction_in.unit_cost,
        reference_document=transaction_in.reference_document,
        notes=transaction_in.notes,
        request_id=transaction_in.request_id,
        request_fingerprint=fingerprint,
    )
    db.add(AuditLog(user_id=current_user.id, action="INVENTORY_MOVEMENT", entity_type="Product", entity_id=str(transaction_in.product_id), new_value={"quantity": str(quantity), "type": transaction_in.transaction_type.value if hasattr(transaction_in.transaction_type, "value") else transaction_in.transaction_type, "warehouse_id": str(transaction_in.warehouse_id)}))
    await notify_low_stock_crossing(db, product, stock_before, balance.current_stock)
    
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(select(InventoryTransaction).where(
            InventoryTransaction.request_id == transaction_in.request_id
        ))).scalar_one_or_none()
        if existing is None:
            raise
        if existing.user_id != current_user.id or existing.request_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="Request ID was already used for a different movement")
        return existing
    await db.refresh(new_transaction)
    
    return new_transaction

@router.get("/balances", response_model=List[InventoryBalanceResponse],
           summary="🏦 Get inventory balances by warehouse")
async def get_inventory_balances(
    warehouse_id: UUID = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Get all inventory balances, optionally filtered by warehouse, including product and warehouse names.
    """
    query = (
        select(InventoryBalance, Product.name_ar.label("product_name"), Warehouse.name.label("warehouse_name"))
        .join(Product, InventoryBalance.product_id == Product.id)
        .join(Warehouse, InventoryBalance.warehouse_id == Warehouse.id)
    )
    if warehouse_id:
        query = query.where(InventoryBalance.warehouse_id == warehouse_id)
        
    result = await db.execute(query)
    rows = result.all()
    
    # Map the result into the Pydantic schema
    balances = []
    for row in rows:
        balance, product_name, warehouse_name = row
        balance_dict = {
            "id": balance.id,
            "product_id": balance.product_id,
            "warehouse_id": balance.warehouse_id,
            "current_stock": balance.current_stock,
            "updated_at": balance.updated_at,
            "product_name": product_name,
            "warehouse_name": warehouse_name
        }
        balances.append(balance_dict)
        
    return balances

@router.get("/stats", response_model=InventoryStatsResponse,
           summary="📊 Inventory dashboard statistics")
async def get_inventory_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Get inventory dashboard statistics.
    """
    # 1. Today's transactions
    now = datetime.now(ZoneInfo("Africa/Cairo"))
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    today_movements = None
    if current_user.role == RoleEnum.ADMIN:
        today_movements_query = select(func.count(InventoryTransaction.id)).where(
            InventoryTransaction.created_at >= day_start.astimezone(timezone.utc),
            InventoryTransaction.created_at < day_end.astimezone(timezone.utc),
        )
        today_movements = (await db.execute(today_movements_query)).scalar() or 0

    # Subquery to sum inventory balance per product
    inventory_summary = (
        select(
            InventoryBalance.product_id,
            func.sum(InventoryBalance.current_stock).label("total_stock")
        )
        .group_by(InventoryBalance.product_id)
        .subquery()
    )

    # 2. Low stock and critical stock
    # Join Product and inventory_summary to include products with no balance (stock = 0)
    # Low stock: stock > 0 AND stock <= min_stock_level
    low_stock_query = select(func.count(Product.id)).outerjoin(
        inventory_summary, Product.id == inventory_summary.c.product_id
    ).where(
        (func.coalesce(inventory_summary.c.total_stock, 0) > 0) &
        (func.coalesce(inventory_summary.c.total_stock, 0) <= Product.min_stock_level),
        Product.is_deleted == False
    )
    low_stock = (await db.execute(low_stock_query)).scalar() or 0
    
    # Critical stock: stock <= 0
    critical_stock_query = select(func.count(Product.id)).outerjoin(
        inventory_summary, Product.id == inventory_summary.c.product_id
    ).where(
        (func.coalesce(inventory_summary.c.total_stock, 0) <= 0),
        Product.is_deleted == False
    )
    critical_stock = (await db.execute(critical_stock_query)).scalar() or 0

    # Purchase-cost valuation; retail prices are sales potential, not inventory value.
    value_query = select(func.sum(InventoryBalance.current_stock * Product.cost)).join(
        Product, InventoryBalance.product_id == Product.id
    ).where(Product.is_deleted == False)
    total_value = (await db.execute(value_query)).scalar() or 0

    return {
        "today_movements": today_movements,
        "low_stock_count": low_stock,
        "critical_stock_count": critical_stock,
        "total_value": total_value
    }

@router.get("/transactions", response_model=PaginatedInventoryTransactionResponse,
           summary="Get paginated inventory transactions")
async def get_inventory_transactions(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    product_id: UUID | None = Query(None),
    recent_days: int | None = Query(None, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    offset = (page - 1) * limit
    criteria = []
    if product_id is not None:
        criteria.append(InventoryTransaction.product_id == product_id)
    if recent_days is not None:
        criteria.append(InventoryTransaction.created_at >= datetime.now(timezone.utc) - timedelta(days=recent_days))
    
    # Get total count
    total_query = select(func.count(InventoryTransaction.id)).where(*criteria)
    total = (await db.execute(total_query)).scalar() or 0

    # Get paginated data with product names
    query = (
        select(InventoryTransaction, Product.name_ar)
        .outerjoin(Product, InventoryTransaction.product_id == Product.id)
        .where(*criteria)
        .order_by(InventoryTransaction.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    rows = result.all()
    
    transactions = []
    for row in rows:
        transaction, product_name = row
        tx_dict = transaction.__dict__.copy()
        tx_dict["product_name"] = product_name
        transactions.append(tx_dict)
        
    return {"data": transactions, "total": total}

@router.get("/transactions/recent", response_model=List[InventoryTransactionRecentResponse],
           summary="⏳ Recent inventory transactions")
async def get_recent_transactions(
    limit: int = Query(5, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Get the most recent inventory transactions.
    """
    query = (
        select(InventoryTransaction, Product.name_ar.label("product_name"))
        .join(Product, InventoryTransaction.product_id == Product.id)
        .order_by(desc(InventoryTransaction.created_at))
        .limit(limit)
    )
    result = await db.execute(query)
    rows = result.all()
    
    transactions = []
    for row in rows:
        transaction, product_name = row
        tx_dict = {
            "id": transaction.id,
            "product_id": transaction.product_id,
            "warehouse_id": transaction.warehouse_id,
            "user_id": transaction.user_id,
            "transaction_type": transaction.transaction_type,
            "quantity_changed": transaction.quantity_changed,
            "reference_document": transaction.reference_document,
            "notes": transaction.notes,
            "created_at": transaction.created_at,
            "product_name": product_name
        }
        transactions.append(tx_dict)
        
    return transactions
