import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from core.database import async_session
from models.inventory import InventoryTransaction, InventoryBalance
from sqlalchemy import select

async def check():
    async with async_session() as session:
        r = await session.execute(select(InventoryTransaction.transaction_type, InventoryTransaction.quantity_changed, InventoryTransaction.notes))
        print("Transactions:", r.all())
        
        b = await session.execute(select(InventoryBalance.current_stock))
        print("Balances:", b.all())

if __name__ == "__main__":
    asyncio.run(check())
