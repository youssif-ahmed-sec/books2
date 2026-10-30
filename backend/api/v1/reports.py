from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Annotated, Optional
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import func

from database import get_db
from models.order import Order
from models.inventory import InventoryTransaction
from models.customer import Customer
from models.user import User
from core.dependencies import require_admin, require_sales_reporting_access, require_inventory_access
from services.analytics_service import financial_summary, stock_alerts, daily_sales_trend, daily_inventory_activity, product_sales_activity, COMPLETED

router = APIRouter(prefix="/reports", tags=["Reports"])


def _report_bounds(start_date: datetime | None, end_date: datetime | None,
                   start_day: date | None, end_day: date | None):
    if (start_day is not None or end_day is not None) and (start_date is not None or end_date is not None):
        raise HTTPException(status_code=422, detail="Choose dates or timestamps, not both")
    if start_day and end_day and end_day < start_day:
        raise HTTPException(status_code=422, detail="End date must not be before start date")
    cairo = ZoneInfo("Africa/Cairo")
    if start_day:
        start_date = datetime.combine(start_day, time.min, tzinfo=cairo)
    if end_day:
        end_date = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=cairo)
    if start_date and end_date and end_date <= start_date:
        raise HTTPException(status_code=422, detail="End date must be after start date")
    return start_date, end_date


@router.get("/product-activity", summary="Product sales movement and reorder context")
async def get_product_activity(
    start_day: date | None = None,
    end_day: date | None = None,
    dormant_days: Annotated[int, Query(ge=30, le=365)] = 90,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    today = datetime.now(ZoneInfo("Africa/Cairo")).date()
    first = start_day or today.replace(day=1)
    last = end_day or today
    if last < first or (last - first).days > 366:
        raise HTTPException(status_code=422, detail="Choose a valid period of at most one year")
    start = datetime.combine(first, time.min, tzinfo=ZoneInfo("Africa/Cairo"))
    end = datetime.combine(last + timedelta(days=1), time.min,
                           tzinfo=ZoneInfo("Africa/Cairo"))
    rows = await product_sales_activity(db, start, end, dormant_days)
    return {"start_day": first, "end_day": last, "dormant_days": dormant_days,
            "dormant_count": sum(row["dormant"] for row in rows),
            "reorder_count": sum(row["reorder_priority"] for row in rows),
            "products": sorted(rows, key=lambda row: (-row["quantity_sold"], row["name"]))}

@router.get("/sales", summary="Get sales report")
async def get_sales_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    start_day: Optional[date] = None,
    end_day: Optional[date] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_sales_reporting_access),
):
    """
    Get aggregated sales report (orders).
    """
    start_date, end_date = _report_bounds(start_date, end_date, start_day, end_day)
    criteria = []
    if start_date:
        criteria.append(Order.created_at >= start_date)
    if end_date:
        criteria.append(Order.created_at < end_date)
    total_orders = (await db.execute(select(func.count(Order.id)).where(*criteria))).scalar_one()
    completed_orders = (await db.execute(select(func.count(Order.id)).where(
        *criteria, Order.status.in_(COMPLETED),
    ))).scalar_one()
    rows = (await db.execute(select(
        Order.id, Customer.name, Order.source, Order.status, Order.total_amount, Order.created_at,
        User.full_name, User.username, User.email,
    ).outerjoin(Customer, Order.customer_id == Customer.id).outerjoin(User, User.id == Order.user_id).where(*criteria)
        .order_by(Order.created_at.desc(), Order.id.desc()).limit(limit).offset(offset))).all()
    summary = await financial_summary(db, start_date, end_date)
    return {
        "financial": summary,
        "metrics": {
            "total_revenue": summary["net_sales"],
            "total_orders": total_orders,
            "completed_orders": completed_orders
        },
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(rows) < total_orders,
        "data": [
            {
                "id": order_id,
                "created_at": created_at,
                "status": status,
                "customer_name": customer_name,
                "employee_name": full_name or username or email,
                "source": source,
                "final_total": float(total_amount),
            } for order_id, customer_name, source, status, total_amount, created_at, full_name, username, email in rows
        ]
    }


@router.get("/sales-trend", summary="Daily net sales for a bounded chart")
async def get_sales_trend(
    days: Annotated[int, Query(ge=7, le=90)] = 30,
    end_day: date | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    return await daily_sales_trend(db, days=days, end_day=end_day)


@router.get("/financial-summary", summary="Net sales, profit and cash movements")
async def get_financial_summary(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    return await financial_summary(db, start_date, end_date)


@router.get("/stock-alerts", summary="Low and out of stock products")
async def get_stock_alerts(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_inventory_access),
):
    return await stock_alerts(db)

@router.get("/inventory", summary="Get inventory movements report")
async def get_inventory_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    start_day: Optional[date] = None,
    end_day: Optional[date] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Get inventory movements (transactions).
    """
    start_date, end_date = _report_bounds(start_date, end_date, start_day, end_day)
    query = select(InventoryTransaction, User.full_name, User.username, User.email).outerjoin(User, User.id == InventoryTransaction.user_id)
    
    if start_date:
        query = query.where(InventoryTransaction.created_at >= start_date)
    if end_date:
        query = query.where(InventoryTransaction.created_at < end_date)
        
    result = await db.execute(query.order_by(
        InventoryTransaction.created_at.desc(), InventoryTransaction.id.desc(),
    ).limit(limit + 1).offset(offset))
    transactions = result.all()
    has_more = len(transactions) > limit
    return {"offset": offset, "limit": limit, "has_more": has_more, "data": [
        {
            "id": tx.id,
            "transaction_type": tx.transaction_type.value if hasattr(tx.transaction_type, "value") else tx.transaction_type,
            "product_id": tx.product_id,
            "warehouse_id": tx.warehouse_id,
            "quantity_changed": float(tx.quantity_changed),
            "reference_document": tx.reference_document,
            "created_at": tx.created_at,
            "user_id": tx.user_id,
            "employee_name": full_name or username or email,
            "notes": tx.notes
        } for tx, full_name, username, email in transactions[:limit]
    ]}


@router.get("/inventory-trend", summary="Daily stock movement counts for a bounded chart")
async def get_inventory_trend(
    days: Annotated[int, Query(ge=7, le=90)] = 30,
    end_day: date | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    return await daily_inventory_activity(db, days=days, end_day=end_day)
