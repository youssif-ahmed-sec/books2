from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.notification import Notification
from models.user import RoleEnum, User


async def notify_roles(
    db: AsyncSession, roles: tuple[RoleEnum, ...], *, kind: str,
    title: str, message: str, href: str,
) -> None:
    """Queue per-user records in the caller's transaction, never after its commit."""
    recipient_ids = (await db.execute(select(User.id).where(
        User.role.in_(roles), User.is_active == True, User.is_deleted == False,
    ))).scalars().all()
    db.add_all(Notification(
        user_id=user_id, kind=kind, title=title, message=message, href=href,
    ) for user_id in recipient_ids)


def notify_user(db: AsyncSession, user_id, *, kind: str, title: str, message: str, href: str) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, message=message, href=href))


async def notify_low_stock_crossing(db: AsyncSession, product, before: Decimal, after: Decimal) -> None:
    minimum = Decimal(str(product.min_stock_level or 0))
    if after == 0 and before > 0:
        await notify_roles(db, (RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER),
                           kind="out_of_stock", title="نفاد مخزون",
                           message=f"{product.name_ar} · الرصيد صفر {product.base_unit}", href="/inventory")
        return
    crossed = (before > minimum and after <= minimum) if minimum > 0 else (before >= 5 and after < 5)
    if after < before and crossed:
        await notify_roles(db, (RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER),
                           kind="low_stock", title="مخزون منخفض",
                           message=f"{product.name_ar} · الرصيد {after} {product.base_unit}", href="/inventory")
