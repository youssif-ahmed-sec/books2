import asyncio
import os
import sys

# Add backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from core.database import async_session
from models.product import Product
from models.inventory import InventoryBalance
from sqlalchemy import select

async def check():
    async with async_session() as session:
        r = await session.execute(
            select(Product.name_en, Product.cost, InventoryBalance.current_stock)
            .join(InventoryBalance, Product.id == InventoryBalance.product_id)
        )
        print("Data:", r.all())

if __name__ == "__main__":
    asyncio.run(check())
