from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import func, or_
from typing import List, Optional

from database import get_db
from models.product import Product, ProductUnit
from models.inventory import InventoryBalance
from schemas.product import ProductResponse

router = APIRouter(prefix="/pos", tags=["POS"])

@router.get("/search", response_model=List[ProductResponse])
async def search_pos_products(
    q: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Fast product search for POS by barcode, SKU, or name.
    Returns products with units, prices, and current stock.
    """
    base_query = select(Product).where(Product.is_deleted == False)
    
    if q:
        search_pattern = f"%{q}%"
        # Search by product barcode, unit barcode, sku, or names
        # To search by unit barcode, we can join ProductUnit or use an exists subquery
        unit_exists = select(ProductUnit.product_id).where(
            (ProductUnit.product_id == Product.id) & 
            (ProductUnit.barcode.ilike(search_pattern))
        ).exists()
        
        base_query = base_query.where(
            or_(
                Product.sku.ilike(search_pattern),
                Product.barcode.ilike(search_pattern),
                Product.name_en.ilike(search_pattern),
                Product.name_ar.ilike(search_pattern),
                unit_exists
            )
        )
        
    query = base_query.options(
        selectinload(Product.units).selectinload(ProductUnit.prices),
        selectinload(Product.category)
    ).limit(limit)
    
    result = await db.execute(query)
    products = result.scalars().unique().all()
    
    # Fast bulk stock lookup
    if not products:
        return []
        
    product_ids = [p.id for p in products]
    stock_query = select(
        InventoryBalance.product_id, 
        func.sum(InventoryBalance.current_stock).label("total_stock")
    ).where(InventoryBalance.product_id.in_(product_ids)).group_by(InventoryBalance.product_id)
    
    stock_result = await db.execute(stock_query)
    stock_map = {row.product_id: row.total_stock for row in stock_result.all()}
    
    for p in products:
        setattr(p, "current_stock", stock_map.get(p.id, 0))
        
    return products
