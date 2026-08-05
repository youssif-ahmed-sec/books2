from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update
from uuid import UUID
from typing import List

from models.inventory import InventoryTransaction, InventoryBalance, Warehouse
from models.product import Product, ProductUnit, ProductPrice
from models.user import User
from schemas.inventory import InventoryTransactionCreate, InventoryTransactionResponse, InventoryBalanceResponse, InventoryStatsResponse, InventoryTransactionRecentResponse, PaginatedInventoryTransactionResponse
from sqlalchemy import func, desc
from datetime import date
from core.dependencies import get_current_user
from database import get_db
from fastapi_cache.decorator import cache

router = APIRouter(prefix="/inventory", tags=["Inventory"])

@router.post("/transactions", response_model=InventoryTransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_inventory_transaction(
    transaction_in: InventoryTransactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new inventory transaction and update the inventory balance.
    """
    # 1. Fetch current balance
    balance_query = select(InventoryBalance).where(
        InventoryBalance.product_id == transaction_in.product_id,
        InventoryBalance.warehouse_id == transaction_in.warehouse_id
    )
    result = await db.execute(balance_query)
    balance = result.scalar_one_or_none()
    
    if not balance:
        # Create a new balance record if it doesn't exist
        balance = InventoryBalance(
            product_id=transaction_in.product_id,
            warehouse_id=transaction_in.warehouse_id,
            current_stock=0
        )
        db.add(balance)
        await db.flush()

    # 2. Update stock based on transaction type
    # (Simplified logic, usually RECEIVING adds, ISSUING subtracts)
    if transaction_in.transaction_type in ["Issuing", "Adjustment"]:
        balance.current_stock += transaction_in.quantity_changed
    else:
        balance.current_stock += transaction_in.quantity_changed
        
    # 3. Record transaction
    new_transaction = InventoryTransaction(
        product_id=transaction_in.product_id,
        warehouse_id=transaction_in.warehouse_id,
        user_id=current_user.id,
        transaction_type=transaction_in.transaction_type,
        quantity_changed=transaction_in.quantity_changed,
        reference_document=transaction_in.reference_document,
        notes=transaction_in.notes
    )
    
    db.add(new_transaction)
    
    # In a real scenario, AuditLog would also be created here
    
    await db.commit()
    await db.refresh(new_transaction)
    
    return new_transaction

@router.get("/balances", response_model=List[InventoryBalanceResponse],
           summary="🏦 Get inventory balances by warehouse")
async def get_inventory_balances(
    warehouse_id: UUID = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
):
    """
    Get inventory dashboard statistics.
    """
    # 1. Today's transactions
    today = date.today()
    today_movements_query = select(func.count(InventoryTransaction.id)).where(
        func.date(InventoryTransaction.created_at) == today
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

    # 3. Total value (sum of current_stock * retail_price of base unit)
    value_query = select(func.sum(InventoryBalance.current_stock * ProductPrice.price)).join(
        Product, InventoryBalance.product_id == Product.id
    ).join(
        ProductUnit, (ProductUnit.product_id == Product.id) & (ProductUnit.unit_name == Product.base_unit)
    ).join(
        ProductPrice, (ProductPrice.unit_id == ProductUnit.id) & (ProductPrice.price_level == 'Retail')
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
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    offset = (page - 1) * limit
    
    # Get total count
    total_query = select(func.count(InventoryTransaction.id))
    total = (await db.execute(total_query)).scalar() or 0

    # Get paginated data with product names
    query = (
        select(InventoryTransaction, Product.name_ar)
        .outerjoin(Product, InventoryTransaction.product_id == Product.id)
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
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
