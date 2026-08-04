import asyncio
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))
from dotenv import load_dotenv
load_dotenv()
from database import AsyncSessionLocal as async_session
from models.product import Product, ProductUnit

async def test_update():
    async with async_session() as session:
        from api.v1.products import get_products
        try:
            res = await get_products(search=None, db=session)
            print(f"Got {len(res)} products")
            from schemas.product import ProductResponse
            from pydantic import TypeAdapter
            ta = TypeAdapter(list[ProductResponse])
            json_data = ta.dump_python(res, mode='json')
            print("Serialization successful!", len(json_data))
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_update())
