import asyncio
import time

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import case, func
from typing import Dict, Any
from datetime import datetime
from zoneinfo import ZoneInfo

from core.dependencies import oauth2_scheme, require_admin
from core.dashboard_events import dashboard_event_hub
from core.security import decode_access_token
from database import get_db
from models.order import Order, OrderStatusEnum
from models.product import Product
from models.user import User
from models.financial import CashShift
from services.cash_register_service import expected_cash
from services.analytics_service import financial_summary, stock_alerts, management_details, daily_sales_trend

router = APIRouter(prefix="/dashboards", tags=["Dashboards"])


@router.get("/management/events")
async def management_events(request: Request, _user: User = Depends(require_admin, scope="function"),
                            token: str = Depends(oauth2_scheme)):
    """Tell an authorized dashboard to refetch after a committed input change."""
    expires_at = decode_access_token(token)["exp"]
    deadline = time.monotonic() + max(0, int(expires_at) - time.time())
    try:
        queue = await dashboard_event_hub.subscribe()
    except (asyncpg.PostgresError, OSError, TimeoutError, RuntimeError):
        raise HTTPException(status_code=503, detail="Dashboard live updates unavailable")

    async def stream():
        try:
            # A fetch after LISTEN is active closes the subscribe/first-read race.
            yield "data: ready\n\n"
            while time.monotonic() < deadline:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=min(25, max(0.1, deadline - time.monotonic())))
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": keepalive\n\n"
                    continue
                if event == "disconnected":
                    break
                yield "data: changed\n\n"
        finally:
            await dashboard_event_hub.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    })

@router.get("/management", response_model=Dict[str, Any])
async def get_management_dashboard(
    trend_days: int = Query(14, ge=7, le=30),
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
    products_q = await db.execute(select(
        func.count(Product.id),
        func.coalesce(func.sum(case((Product.is_active == True, 1), else_=0)), 0),
    ).where(Product.is_deleted == False))
    total_products, active_products = products_q.one()

    now = datetime.now(ZoneInfo("Africa/Cairo"))
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    today = await financial_summary(db, day_start, None)
    month = await financial_summary(db, month_start, None)
    overall = await financial_summary(db)
    alerts = await stock_alerts(db)
    trend = await daily_sales_trend(db, days=trend_days)
    open_shifts = (await db.execute(select(CashShift).where(CashShift.status == "OPEN"))).scalars().all()
    open_drawer_cash = sum([await expected_cash(db, shift) for shift in open_shifts], start=0)
    return {
        "total_orders": total_orders,
        "total_revenue": overall["net_sales"],
        "pending_orders": pending_orders,
        "total_products": total_products,
        "active_products": active_products,
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
        "sales_trend": trend,
    }


@router.get("/management-details", response_model=Dict[str, Any])
async def get_management_details(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    return await management_details(db, datetime.now(ZoneInfo("Africa/Cairo")))

@router.get("/conversations", response_model=Dict[str, Any])
async def get_conversations_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Shady's primary view: Active Leads and Draft Orders.
    """
    lead_count = (await db.execute(
        select(func.count(Order.id)).where(Order.status == OrderStatusEnum.NEW_LEAD.value)
    )).scalar_one()

    active_count = (await db.execute(
        select(func.count(Order.id)).where(Order.status.in_([
            OrderStatusEnum.DRAFT.value,
            OrderStatusEnum.WAITING_APPROVAL.value,
        ]))
    )).scalar_one()

    return {
        "new_leads": lead_count,
        "active_orders": active_count
    }
