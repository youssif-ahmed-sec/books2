"""Inventory reports retained while the sales modules are paused."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_inventory_access
from database import get_db
from models.user import User
from services.analytics_service import stock_alerts

router = APIRouter(prefix="/reports", tags=["Inventory reports"])


@router.get("/stock-alerts")
async def get_stock_alerts(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_inventory_access),
):
    return await stock_alerts(db)
