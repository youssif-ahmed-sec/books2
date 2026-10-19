from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Annotated, Optional
from datetime import date, datetime
from sqlalchemy import func

from database import get_db
from models.order import Order
from models.inventory import InventoryTransaction
from models.customer import Customer
from models.user import User
from core.dependencies import require_admin, require_sales_reporting_access, require_inventory_access
from services.analytics_service import financial_summary, stock_alerts, daily_sales_trend, daily_inventory_activity, COMPLETED

router = APIRouter(prefix="/reports", tags=["Reports"])

@router.get("/sales", summary="Get sales report")
async def get_sales_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_sales_reporting_access),
):
    """
    Get aggregated sales report (orders).
    """
    if start_date and end_date and end_date <= start_date:
        raise HTTPException(status_code=422, detail="End date must be after start date")
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
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Get inventory movements (transactions).
    """
    if start_date and end_date and end_date <= start_date:
        raise HTTPException(status_code=422, detail="End date must be after start date")
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
