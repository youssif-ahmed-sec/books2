"""Keep display-only audit events for ninety days."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from database import AsyncSessionLocal
from models.user import AuditLog


logger = logging.getLogger(__name__)
AUDIT_RETENTION = timedelta(days=90)
PURGE_INTERVAL_SECONDS = 60 * 60
BATCH_SIZE = 1000


def audit_cutoff() -> datetime:
    return datetime.now(timezone.utc) - AUDIT_RETENTION


async def purge_expired_audit_logs() -> int:
    async with AsyncSessionLocal() as db:
        expired_ids = select(AuditLog.id).where(AuditLog.created_at < audit_cutoff()).order_by(
            AuditLog.created_at, AuditLog.id,
        ).limit(BATCH_SIZE)
        result = await db.execute(delete(AuditLog).where(AuditLog.id.in_(expired_ids)))
        await db.commit()
        return result.rowcount or 0


async def run_audit_retention() -> None:
    logger.info("Audit retention cleanup started (90 days, hourly)")
    while True:
        deleted = 0
        try:
            deleted = await purge_expired_audit_logs()
            if deleted:
                logger.info("Deleted %s expired audit events", deleted)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Audit retention cleanup failed; retrying in one hour")
        await asyncio.sleep(10 if deleted == BATCH_SIZE else PURGE_INTERVAL_SECONDS)
