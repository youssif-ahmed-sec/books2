"""Create an initial admin using explicitly supplied environment settings."""

import asyncio
import os

from sqlalchemy import select


def required_setting(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set explicitly")
    return value


async def seed() -> None:
    # Require an explicit target so a local .env cannot silently select production.
    required_setting("DATABASE_URL")
    email = required_setting("SEED_ADMIN_EMAIL").lower()
    username = required_setting("SEED_ADMIN_USERNAME").lower()
    full_name = required_setting("SEED_ADMIN_FULL_NAME")
    password = required_setting("SEED_ADMIN_PASSWORD")
    if len(password) < 12:
        raise RuntimeError("SEED_ADMIN_PASSWORD must contain at least 12 characters")

    from core.security import hash_password
    from database import AsyncSessionLocal, engine
    from models.user import RoleEnum, User

    try:
        async with AsyncSessionLocal() as session:
            existing = await session.scalar(
                select(User).where((User.email == email) | (User.username == username))
            )
            if existing is not None:
                print("Admin account already exists; no changes made")
                return
            session.add(
                User(
                    email=email,
                    username=username,
                    full_name=full_name,
                    hashed_password=hash_password(password),
                    role=RoleEnum.ADMIN,
                    is_active=True,
                    is_deleted=False,
                )
            )
            await session.commit()
            print("Admin account created")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
