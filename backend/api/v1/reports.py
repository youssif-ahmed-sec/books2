from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional
from datetime import datetime
from sqlalchemy import func

from database import get_db
from models.order import Order, OrderStatusEnum
from models.inventory import InventoryTransaction
from models.user import User
from core.dependencies import get_current_user, require_sales_reports_access

router = APIRouter(prefix="/reports", tags=["Reports"])

@router.get("/sales", summary="Get sales report")
async def get_sales_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_sales_reports_access),
):
    """
    Get aggregated sales report (orders).
    """
    query = select(Order).where(Order.is_deleted == False)
    
    if start_date:
        query = query.where(Order.created_at >= start_date)
    if end_date:
        query = query.where(Order.created_at <= end_date)
        
    query = query.order_by(Order.created_at.desc())
    
    result = await db.execute(query)
    orders = result.scalars().all()
    
    total_revenue = sum(float(order.final_total) for order in orders if order.status == OrderStatusEnum.CLOSED.value)
    completed_orders = sum(1 for order in orders if order.status == OrderStatusEnum.CLOSED.value)
    
    # Return raw orders and aggregation
    return {
        "metrics": {
            "total_revenue": total_revenue,
            "total_orders": len(orders),
            "completed_orders": completed_orders
        },
        "data": [
            {
                "id": order.id,
                "created_at": order.created_at,
                "status": order.status.value,
                "customer_name": order.customer_name,
                "source": order.source,
                "final_total": order.final_total,
                "payment_status": order.payment_status.value if order.payment_status else None
            } for order in orders
        ]
    }

@router.get("/inventory", summary="Get inventory movements report")
async def get_inventory_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_sales_reports_access),
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
            "type": tx.type.value,
            "product_id": tx.product_id,
            "unit_id": tx.unit_id,
            "quantity_change": tx.quantity_change,
            "reference_type": tx.reference_type,
            "reference_id": tx.reference_id,
            "created_at": tx.created_at,
            "created_by_id": tx.created_by_id,
            "notes": tx.notes
        } for tx in transactions
    ]
