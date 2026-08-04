import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from core.database import async_session
from models.product import Product

async def check():
    async with async_session() as session:
        from sqlalchemy import select
        r = await session.execute(select(Product.name_en, Product.cost))
        print("Costs:", r.all())

if __name__ == "__main__":
    asyncio.run(check())
