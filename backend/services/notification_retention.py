"""Expire notification rows seven days after creation."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

from database import AsyncSessionLocal
from models.notification import Notification


logger = logging.getLogger(__name__)
NOTIFICATION_RETENTION = timedelta(days=7)
PURGE_INTERVAL_SECONDS = 60 * 60


def notification_cutoff() -> datetime:
    return datetime.now(timezone.utc) - NOTIFICATION_RETENTION


async def purge_expired_notifications() -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(delete(Notification).where(
            Notification.created_at < notification_cutoff(),
        ))
        await db.commit()
        return result.rowcount or 0


async def run_notification_retention() -> None:
    logger.info("Notification retention cleanup started (7 days, hourly)")
    while True:
        try:
            deleted = await purge_expired_notifications()
            if deleted:
                logger.info("Deleted %s expired notifications", deleted)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Notification retention cleanup failed; retrying in one hour")
        await asyncio.sleep(PURGE_INTERVAL_SECONDS)
