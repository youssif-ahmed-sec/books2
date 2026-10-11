from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin
from database import get_db
from models.user import AuditLog, User

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("")
async def audit_history(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    rows = (await db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).offset(offset).limit(limit))).scalars().all()
    return [{"id": row.id, "user_id": row.user_id, "action": row.action, "entity_type": row.entity_type,
             "entity_id": row.entity_id, "old_value": row.old_value, "new_value": row.new_value,
             "created_at": row.created_at} for row in rows]
