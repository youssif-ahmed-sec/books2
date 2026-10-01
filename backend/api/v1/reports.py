from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Optional
from datetime import datetime

from database import get_db
from models.order import Order, OrderStatusEnum
from models.inventory import InventoryTransaction
from models.customer import Customer
from models.user import User
from core.dependencies import require_inventory_access, require_admin

router = APIRouter(prefix="/reports", tags=["Reports"])

@router.get("/sales", summary="Get sales report")
async def get_sales_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Get aggregated sales report (orders).
    """
    query = select(Order, Customer.name).outerjoin(Customer, Order.customer_id == Customer.id)
    
    if start_date:
        query = query.where(Order.created_at >= start_date)
    if end_date:
        query = query.where(Order.created_at <= end_date)
        
    query = query.order_by(Order.created_at.desc())
    
    result = await db.execute(query)
    rows = result.all()
    
    completed_statuses = {OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value}
    total_revenue = sum(float(order.total_amount) for order, _ in rows if order.status in completed_statuses)
    completed_orders = sum(1 for order, _ in rows if order.status in completed_statuses)
    
    # Return raw orders and aggregation
    return {
        "metrics": {
            "total_revenue": total_revenue,
            "total_orders": len(rows),
            "completed_orders": completed_orders
        },
        "data": [
            {
                "id": order.id,
                "created_at": order.created_at,
                "status": order.status,
                "customer_name": customer_name,
                "source": order.source,
                "final_total": float(order.total_amount),
            } for order, customer_name in rows
        ]
    }

@router.get("/inventory", summary="Get inventory movements report")
async def get_inventory_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Get inventory movements (transactions).
    """
    query = select(InventoryTransaction).order_by(InventoryTransaction.created_at.desc())
    
    if start_date:
        query = query.where(InventoryTransaction.created_at >= start_date)
    if end_date:
        query = query.where(InventoryTransaction.created_at <= end_date)
        
    result = await db.execute(query)
    transactions = result.scalars().all()
    
    return [
        {
            "id": tx.id,
            "transaction_type": tx.transaction_type.value if hasattr(tx.transaction_type, "value") else tx.transaction_type,
            "product_id": tx.product_id,
            "warehouse_id": tx.warehouse_id,
            "quantity_changed": float(tx.quantity_changed),
            "reference_document": tx.reference_document,
            "created_at": tx.created_at,
            "user_id": tx.user_id,
            "notes": tx.notes
        } for tx in transactions
    ]
