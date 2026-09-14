from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import Dict, Any

from core.dependencies import get_current_user
from database import get_db
from models.order import Order, OrderStatusEnum
from models.product import Product
from models.user import User

router = APIRouter(prefix="/dashboards", tags=["Dashboards"])

@router.get("/management", response_model=Dict[str, Any])
async def get_management_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Management Dashboard Metrics:
    - Today's Sales
    - Total Orders
    - Pending Orders
    - Total Products
    """
    # Total Orders
    orders_q = await db.execute(select(func.count(Order.id)))
    total_orders = orders_q.scalar_one_or_none() or 0
    
    # Total Revenue (Closed/Delivered)
    revenue_q = await db.execute(
        select(func.sum(Order.total_amount))
        .where(Order.status.in_([OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value]))
    )
    total_revenue = revenue_q.scalar_one_or_none() or 0

    # Pending Orders
    pending_q = await db.execute(
        select(func.count(Order.id))
        .where(Order.status.in_([
            OrderStatusEnum.DRAFT.value,
            OrderStatusEnum.WAITING_QUOTATION.value,
            OrderStatusEnum.WAITING_APPROVAL.value,
            OrderStatusEnum.PREPARING.value
        ]))
    )
    pending_orders = pending_q.scalar_one_or_none() or 0

    # Total Products
    products_q = await db.execute(select(func.count(Product.id)).where(Product.is_deleted == False))
    total_products = products_q.scalar_one_or_none() or 0

    return {
        "total_orders": total_orders,
        "total_revenue": float(total_revenue),
        "pending_orders": pending_orders,
        "total_products": total_products
    }

@router.get("/conversations", response_model=Dict[str, Any])
async def get_conversations_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Shady's primary view: Active Leads and Draft Orders.
    """
    leads_q = await db.execute(
        select(Order).where(Order.status == OrderStatusEnum.NEW_LEAD.value)
    )
    leads = leads_q.scalars().all()

    active_orders_q = await db.execute(
        select(Order).where(Order.status.in_([
            OrderStatusEnum.DRAFT.value,
            OrderStatusEnum.WAITING_APPROVAL.value,
        ]))
    )
    active_orders = active_orders_q.scalars().all()

    return {
        "new_leads": len(leads),
        "active_orders": len(active_orders)
    }
