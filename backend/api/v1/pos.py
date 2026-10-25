from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import aliased, joinedload, selectinload
from sqlalchemy import func, or_, not_
from typing import Annotated, List, Optional
from uuid import UUID
from decimal import Decimal

from database import get_db
from models.product import Product, ProductUnit, ProductPrice, ProductBundleComponent, PriceLevelEnum
from models.inventory import InventoryBalance
from schemas.product import ProductResponse
from models.user import User
from core.dependencies import require_pos_orders_access
from core.product_access import visible_product

router = APIRouter(prefix="/pos", tags=["POS"])

@router.get("/price-levels")
async def get_price_levels(current_user: User = Depends(require_pos_orders_access)):
    """
    Returns all active price levels in the system.
    """
    mapping = {
        "Retail": "قطاعي",
        "Semi Wholesale": "نصف جملة",
        "Wholesale": "جملة",
        "Super Wholesale": "سوبر جملة",
        "VIP": "خاص"
    }
    return [{"value": e.value, "label": mapping.get(e.value, e.value)} for e in PriceLevelEnum]

@router.get("/search", response_model=List[ProductResponse])
async def search_pos_products(
    q: Optional[str] = Query(None, max_length=120),
    product_id: Optional[UUID] = None,
    barcode: Optional[str] = Query(None, max_length=128),
    category_id: Optional[UUID] = None,
    subcategory_id: Optional[UUID] = None,
    brand_id: Optional[UUID] = None,
    is_bundle: Optional[bool] = None,
    available_only: bool = False,
    warehouse_id: Optional[UUID] = None,
    limit: int = Query(50, ge=1, le=100),
    offset: Annotated[int, Query(ge=0)] = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    """
    Fast product search for POS by barcode, SKU, or name.
    Returns products with units, prices, and current stock.
    """
    base_query = select(Product).where(Product.is_deleted == False, Product.is_active == True)
    if product_id is not None:
        base_query = base_query.where(Product.id == product_id)
    if category_id is not None:
        base_query = base_query.where(Product.category_id == category_id)
    if subcategory_id is not None:
        base_query = base_query.where(Product.subcategory_id == subcategory_id)
    if brand_id is not None:
        base_query = base_query.where(Product.brand_id == brand_id)
    if is_bundle is not None:
        base_query = base_query.where(Product.is_bundle == is_bundle)
    if available_only and is_bundle is True:
        required_component = aliased(ProductBundleComponent)
        required_quantity = select(func.sum(required_component.quantity)).where(
            required_component.bundle_id == ProductBundleComponent.bundle_id,
            required_component.component_id == ProductBundleComponent.component_id,
            required_component.is_deleted == False,
        ).correlate(ProductBundleComponent).scalar_subquery()
        component_stock = select(func.coalesce(func.sum(InventoryBalance.current_stock), 0)).where(
            InventoryBalance.product_id == ProductBundleComponent.component_id,
        )
        if warehouse_id is not None:
            component_stock = component_stock.where(InventoryBalance.warehouse_id == warehouse_id)
        component_stock = component_stock.correlate(ProductBundleComponent).scalar_subquery()
        has_component = select(ProductBundleComponent.id).where(
            ProductBundleComponent.bundle_id == Product.id,
            ProductBundleComponent.is_deleted == False,
        ).exists()
        insufficient_component = select(ProductBundleComponent.id).where(
            ProductBundleComponent.bundle_id == Product.id,
            ProductBundleComponent.is_deleted == False,
            required_quantity > component_stock,
        ).exists()
        base_query = base_query.where(has_component, not_(insufficient_component))
    
    if q:
        search_pattern = f"%{q}%"
        # Search by product barcode, unit barcode, sku, or names
        # To search by unit barcode, we can join ProductUnit or use an exists subquery
        unit_exists = select(ProductUnit.product_id).where(
            (ProductUnit.product_id == Product.id) & 
            (ProductUnit.barcode.ilike(search_pattern)) &
            (ProductUnit.is_deleted == False)
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
        selectinload(Product.units.and_(ProductUnit.is_deleted == False)).joinedload(ProductUnit.prices.and_(ProductPrice.is_deleted == False)),
        joinedload(Product.category),
        joinedload(Product.subcategory),
        joinedload(Product.brand),
        joinedload(Product.supplier),
        selectinload(Product.bundle_components.and_(ProductBundleComponent.is_deleted == False)),
    ).order_by(Product.name_ar, Product.id).offset(offset).limit(limit)
    
    result = await db.execute(query)
    products = result.scalars().unique().all()
    
    # Fast bulk stock lookup
    if not products:
        return []
        
    product_ids = [p.id for p in products]
    stock_query = select(
        InventoryBalance.product_id, 
        func.sum(InventoryBalance.current_stock).label("total_stock")
    ).where(InventoryBalance.product_id.in_(
        set(product_ids) | {
            component.component_id
            for product in products for component in product.bundle_components
        }
    ))
    if warehouse_id is not None:
        stock_query = stock_query.where(InventoryBalance.warehouse_id == warehouse_id)
    stock_query = stock_query.group_by(InventoryBalance.product_id)
    
    stock_result = await db.execute(stock_query)
    stock_map = {row.product_id: row.total_stock for row in stock_result.all()}
    
    for p in products:
        if p.is_bundle:
            required: dict[UUID, Decimal] = {}
            for component in p.bundle_components:
                required[component.component_id] = required.get(component.component_id, Decimal("0")) + Decimal(str(component.quantity))
            available = min(
                (int(Decimal(str(stock_map.get(component_id, 0))) // quantity)
                 for component_id, quantity in required.items()),
                default=0,
            )
            setattr(p, "current_stock", max(0, available))
        else:
            setattr(p, "current_stock", stock_map.get(p.id, 0))
        
    return [visible_product(product, current_user.role) for product in products]
