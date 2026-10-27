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


def stock_alert_severity(stock: Decimal, minimum: Decimal) -> str | None:
    """Match the inventory report's out/low stock classification."""
    if stock <= 0:
        return "out"
    if (minimum > 0 and stock <= minimum) or (minimum == 0 and stock < 5):
        return "low"
    return None


async def notify_stock_alert_after_product_edit(
    db: AsyncSession, product, *, previous_minimum: Decimal,
    previous_active: bool, current_stock: Decimal,
) -> None:
    previous = stock_alert_severity(current_stock, previous_minimum) if previous_active else None
    current = stock_alert_severity(current_stock, Decimal(str(product.min_stock_level or 0))) if product.is_active else None
    if previous is not None or current is None:
        return
    kind, title = ("out_of_stock", "نفاد مخزون") if current == "out" else ("low_stock", "مخزون منخفض")
    await notify_roles(db, (RoleEnum.INVENTORY_CONTROLLER,),
                       kind=kind, title=title,
                       message=f"{product.name_ar} · الرصيد {current_stock} {product.base_unit}", href="/inventory")


async def notify_low_stock_crossing(db: AsyncSession, product, before: Decimal, after: Decimal) -> None:
    minimum = Decimal(str(product.min_stock_level or 0))
    if after == 0 and before > 0:
        await notify_roles(db, (RoleEnum.INVENTORY_CONTROLLER,),
                           kind="out_of_stock", title="نفاد مخزون",
                           message=f"{product.name_ar} · الرصيد صفر {product.base_unit}", href="/inventory")
        return
    crossed = (before > minimum and after <= minimum) if minimum > 0 else (before >= 5 and after < 5)
    if after < before and crossed:
        await notify_roles(db, (RoleEnum.INVENTORY_CONTROLLER,),
                           kind="low_stock", title="مخزون منخفض",
                           message=f"{product.name_ar} · الرصيد {after} {product.base_unit}", href="/inventory")
