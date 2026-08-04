import asyncio
import os
import sys
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.future import select

# Ensure the backend directory is in the path to import models
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from models.user import User, RoleEnum

import ssl

# Connect directly to the production Supabase database
DB_URL = "postgresql+asyncpg://postgres.nxdyxkvqiamjodmnetvs:Qx%2A%2FT%25N4bgf%40K2e@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

engine = create_async_engine(DB_URL, connect_args={"ssl": ssl_ctx})
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def seed():
    async with AsyncSessionLocal() as session:
        # Check if admin exists
        result = await session.execute(select(User).where(User.email == 'admin@saudelshafie.com'))
        user = result.scalar_one_or_none()
        if not user:
            print("Creating admin user...")
            new_admin = User(
                email='admin@saudelshafie.com',
                hashed_password='$2b$12$rYX872qZrZcLuSGO/eP.R.NFbbuaNROmvtEYbMz6Ofyx9LjDBBksG',  # Hash for Admin@2025!
                role=RoleEnum.ADMIN,
                is_active=True,
                is_deleted=False
            )
            session.add(new_admin)
            await session.commit()
            print("✅ Admin created successfully.")
        else:
            print("✅ Admin already exists.")

if __name__ == "__main__":
    asyncio.run(seed())
