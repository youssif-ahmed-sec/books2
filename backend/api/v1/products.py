from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import update
from uuid import UUID
from typing import List, Optional

from models.product import Product, ProductUnit, ProductPrice, Category
from models.user import AuditLog, User
from schemas.product import ProductCreate, ProductUpdate, ProductResponse, CategoryResponse
from core.dependencies import get_current_user
from database import get_db

router = APIRouter(prefix="/products", tags=["Products"])

@router.get("/categories", response_model=List[CategoryResponse])
async def get_categories(db: AsyncSession = Depends(get_db)):
    """
    Get all active categories.
    """
    query = select(Category).where(Category.is_deleted == False)
    result = await db.execute(query)
    return result.scalars().all()

@router.get("", response_model=List[ProductResponse])
async def get_products(
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get products, optionally filtered by search term (sku, barcode, name).
    """
    query = select(Product).where(Product.is_deleted == False)
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (Product.sku.ilike(search_pattern)) | 
            (Product.barcode.ilike(search_pattern)) | 
            (Product.name_en.ilike(search_pattern)) |
            (Product.name_ar.ilike(search_pattern))
        )
    
    # Eagerly load units and prices to prevent N+1 queries
    # Assuming relationship exists, if not, we can query manually or add relationship in models
    # Wait, the models don't have relationship() defined. So we fetch units and prices manually.
    
    result = await db.execute(query)
    products = result.scalars().all()
    
    # Since models don't have relationships, we query units manually for now
    product_ids = [p.id for p in products]
    if product_ids:
        units_query = select(ProductUnit).where(ProductUnit.product_id.in_(product_ids), ProductUnit.is_deleted == False)
        units_result = await db.execute(units_query)
        units = units_result.scalars().all()
        
        prices_query = select(ProductPrice).where(ProductPrice.product_id.in_(product_ids), ProductPrice.is_deleted == False)
        prices_result = await db.execute(prices_query)
        prices = prices_result.scalars().all()
        
        unit_map = {}
        for unit in units:
            unit_dict = unit.__dict__.copy()
            unit_dict["prices"] = [p for p in prices if p.unit_id == unit.id]
            unit_map.setdefault(unit.product_id, []).append(unit_dict)
            
        product_responses = []
        for p in products:
            p_dict = p.__dict__.copy()
            p_dict["units"] = unit_map.get(p.id, [])
            product_responses.append(p_dict)
            
        return product_responses
    
    return []

@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Get a specific product by ID with its units and prices.
    """
    query = select(Product).where(Product.id == product_id, Product.is_deleted == False)
    result = await db.execute(query)
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    units_query = select(ProductUnit).where(ProductUnit.product_id == product_id, ProductUnit.is_deleted == False)
    units_result = await db.execute(units_query)
    units = units_result.scalars().all()
    
    prices_query = select(ProductPrice).where(ProductPrice.product_id == product_id, ProductPrice.is_deleted == False)
    prices_result = await db.execute(prices_query)
    prices = prices_result.scalars().all()
    
    unit_map = []
    for unit in units:
        unit_dict = unit.__dict__.copy()
        unit_dict["prices"] = [p for p in prices if p.unit_id == unit.id]
        unit_map.append(unit_dict)
        
    p_dict = product.__dict__.copy()
    p_dict["units"] = unit_map
    
    return p_dict

@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    product_in: ProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new product with multiple units and prices.
    """
    # Create Product
    product_dict = product_in.model_dump(exclude={"units"})
    new_product = Product(**product_dict)
    db.add(new_product)
    await db.flush() # To get new_product.id
    
    units_response = []
    # Create Units and Prices
    for unit_in in product_in.units:
        unit_dict = unit_in.model_dump(exclude={"prices"})
        new_unit = ProductUnit(product_id=new_product.id, **unit_dict)
        db.add(new_unit)
        await db.flush() # To get new_unit.id
        
        prices_response = []
        for price_in in unit_in.prices:
            price_dict = price_in.model_dump()
            new_price = ProductPrice(
                product_id=new_product.id,
                unit_id=new_unit.id,
                **price_dict
            )
            db.add(new_price)
            await db.flush()
            prices_response.append(new_price.__dict__)
            
        unit_res = new_unit.__dict__.copy()
        unit_res["prices"] = prices_response
        units_response.append(unit_res)
        
    # Audit Log
    audit = AuditLog(
        user_id=current_user.id,
        action="CREATE_PRODUCT",
        entity_type="Product",
        entity_id=str(new_product.id),
        new_value=product_in.model_dump(mode='json')
    )
    db.add(audit)
    
    await db.commit()
    
    p_dict = new_product.__dict__.copy()
    p_dict["units"] = units_response
    return p_dict

@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    product_in: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update a product. For simplicity, units and prices replacement strategy can be used.
    """
    query = select(Product).where(Product.id == product_id, Product.is_deleted == False)
    result = await db.execute(query)
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    old_value = {
        "sku": product.sku,
        "name_en": product.name_en,
        "cost": float(product.cost) if product.cost else 0
    }
        
    update_data = product_in.model_dump(exclude_unset=True, exclude={"units"})
    for key, value in update_data.items():
        setattr(product, key, value)
        
    # Handle Units and Prices update if provided
    # In a full implementation, you'd carefully update/delete existing records.
    # For this exercise, we will soft-delete existing units/prices and create new ones.
    if product_in.units is not None:
        # Soft delete existing
        await db.execute(
            update(ProductUnit).where(ProductUnit.product_id == product_id).values(is_deleted=True)
        )
        await db.execute(
            update(ProductPrice).where(ProductPrice.product_id == product_id).values(is_deleted=True)
        )
        
        # Add new ones
        for unit_in in product_in.units:
            unit_dict = unit_in.model_dump(exclude={"prices"})
            new_unit = ProductUnit(product_id=product_id, **unit_dict)
            db.add(new_unit)
            await db.flush()
            
            for price_in in unit_in.prices:
                price_dict = price_in.model_dump()
                new_price = ProductPrice(
                    product_id=product_id,
                    unit_id=new_unit.id,
                    **price_dict
                )
                db.add(new_price)
                
    # Audit Log
    audit = AuditLog(
        user_id=current_user.id,
        action="UPDATE_PRODUCT",
        entity_type="Product",
        entity_id=str(product.id),
        old_value=old_value,
        new_value=product_in.model_dump(mode='json', exclude_unset=True)
    )
    db.add(audit)
    
    await db.commit()
    
    # Re-fetch or reconstruct response
    return await get_product(product_id, db)
