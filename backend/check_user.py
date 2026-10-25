"""Inspect user account status on an explicitly selected database."""

import asyncio
import os

from sqlalchemy import select


async def check() -> None:
    if not os.environ.get("DATABASE_URL", "").strip():
        raise RuntimeError("DATABASE_URL must be set explicitly")

    from database import AsyncSessionLocal, engine
    from models.user import User

    try:
        async with AsyncSessionLocal() as session:
            users = (await session.execute(select(User).order_by(User.created_at))).scalars().all()
            print(f"Total users: {len(users)}")
            for user in users:
                print(
                    f"User: {user.username or user.email} | "
                    f"role: {user.role.value} | active: {user.is_active}"
                )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(check())
