from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin
from database import get_db
from models.user import AuditLog, User

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("")
async def audit_history(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, min_length=3, max_length=120),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    query = select(AuditLog, User.full_name, User.username, User.email).outerjoin(User, User.id == AuditLog.user_id)
    if search and search.strip():
        literal = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{literal}%"
        query = query.where(or_(
            AuditLog.action.ilike(pattern, escape="\\"), AuditLog.entity_type.ilike(pattern, escape="\\"),
            AuditLog.entity_id.ilike(pattern, escape="\\"), cast(AuditLog.id, String).ilike(pattern, escape="\\"),
            cast(AuditLog.user_id, String).ilike(pattern, escape="\\"), User.full_name.ilike(pattern, escape="\\"),
        ))
    rows = (await db.execute(query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit))).all()
    return [{"id": row.id, "user_id": row.user_id, "user_name": full_name or username or email,
             "action": row.action, "entity_type": row.entity_type,
             "entity_id": row.entity_id, "old_value": row.old_value, "new_value": row.new_value,
             "created_at": row.created_at} for row, full_name, username, email in rows]
