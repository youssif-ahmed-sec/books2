from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import Dict, Any
from datetime import datetime
from zoneinfo import ZoneInfo

from core.dependencies import get_current_user, require_admin
from database import get_db
from models.order import Order, OrderStatusEnum
from models.product import Product
from models.user import User
from models.financial import CashShift
from services.cash_register_service import expected_cash
from services.analytics_service import financial_summary, stock_alerts, management_details

router = APIRouter(prefix="/dashboards", tags=["Dashboards"])

@router.get("/management", response_model=Dict[str, Any])
async def get_management_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
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

    now = datetime.now(ZoneInfo("Africa/Cairo"))
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    today = await financial_summary(db, day_start, None)
    month = await financial_summary(db, month_start, None)
    overall = await financial_summary(db)
    alerts = await stock_alerts(db)
    details = await management_details(db, now)
    open_shifts = (await db.execute(select(CashShift).where(CashShift.status == "OPEN"))).scalars().all()
    open_drawer_cash = sum([await expected_cash(db, shift) for shift in open_shifts], start=0)
    return {
        "total_orders": total_orders,
        "total_revenue": overall["net_sales"],
        "pending_orders": pending_orders,
        "total_products": total_products,
        "today_sales": today["net_sales"],
        "monthly_sales": month["net_sales"],
        "gross_profit": overall["gross_profit"],
        "net_profit": overall["net_profit"],
        "cash_movement": overall["cash_movement"],
        "open_drawer_cash": float(open_drawer_cash),
        "customer_debt": overall["customer_debt"],
        "low_stock_count": len([alert for alert in alerts if alert["severity"] == "low"]),
        "out_of_stock_count": len([alert for alert in alerts if alert["severity"] == "out"]),
        "stock_alerts": alerts[:20],
        **details,
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
