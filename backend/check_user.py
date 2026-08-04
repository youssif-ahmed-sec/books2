import asyncio
import os
import sys
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.future import select
import ssl

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from models.user import User

DB_URL = "postgresql+asyncpg://postgres.nxdyxkvqiamjodmnetvs:Qx%2A%2FT%25N4bgf%40K2e@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

engine = create_async_engine(DB_URL, connect_args={"ssl": ssl_ctx})
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def check():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User))
        users = result.scalars().all()
        print(f"Total users: {len(users)}")
        for u in users:
            print(f"User: {u.email} | active: {u.is_active} | hash: {u.hashed_password}")

if __name__ == "__main__":
    asyncio.run(check())
