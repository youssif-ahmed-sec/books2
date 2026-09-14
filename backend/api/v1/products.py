from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import update, func, delete, or_, and_
from uuid import UUID
import uuid
from typing import List, Optional
from models.product import Product, ProductUnit, ProductPrice, Category, Subcategory, Brand, Supplier
from models.user import AuditLog, User
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse, TransactionTypeEnum
from schemas.product import (
    ProductCreate, ProductUpdate, ProductResponse, CategoryResponse, CategoryCreate, CategoryUpdate,
    SubcategoryResponse, SubcategoryCreate, SubcategoryUpdate,
    BrandResponse, BrandCreate, BrandUpdate,
    SupplierResponse, PaginatedProductResponse
)
from fastapi_cache.decorator import cache
from core.dependencies import get_current_user, require_basic_staff_access
from database import get_db

router = APIRouter(prefix="/products", tags=["Products"])

@router.get("/categories", response_model=List[CategoryResponse])
@cache(expire=60)
async def get_categories(db: AsyncSession = Depends(get_db)):
    """Get all active categories."""
    query = select(Category).where(Category.is_deleted == False)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    category_in: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    new_cat = Category(**category_in.model_dump())
    db.add(new_cat)
    await db.commit()
    await db.refresh(new_cat)
    return new_cat

@router.put("/categories/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: UUID,
    category_in: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    result = await db.execute(select(Category).where(Category.id == category_id, Category.is_deleted == False))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    for k, v in category_in.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    await db.commit()
    await db.refresh(cat)
    return cat

@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    result = await db.execute(select(Category).where(Category.id == category_id, Category.is_deleted == False))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    cat.is_deleted = True
    await db.commit()

@router.get("/subcategories", response_model=List[SubcategoryResponse])
async def get_subcategories(db: AsyncSession = Depends(get_db)):
    """Get all active subcategories."""
    query = select(Subcategory).where(Subcategory.is_deleted == False)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/subcategories", response_model=SubcategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_subcategory(
    sub_in: SubcategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    new_sub = Subcategory(**sub_in.model_dump())
    db.add(new_sub)
    await db.commit()
    await db.refresh(new_sub)
    return new_sub

@router.put("/subcategories/{sub_id}", response_model=SubcategoryResponse)
async def update_subcategory(
    sub_id: UUID,
    sub_in: SubcategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    result = await db.execute(select(Subcategory).where(Subcategory.id == sub_id, Subcategory.is_deleted == False))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcategory not found")
    for k, v in sub_in.model_dump(exclude_unset=True).items():
        setattr(sub, k, v)
    await db.commit()
    await db.refresh(sub)
    return sub

@router.delete("/subcategories/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subcategory(
    sub_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    result = await db.execute(select(Subcategory).where(Subcategory.id == sub_id, Subcategory.is_deleted == False))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcategory not found")
    sub.is_deleted = True
    await db.commit()

@router.get("/brands", response_model=List[BrandResponse])
async def get_brands(db: AsyncSession = Depends(get_db)):
    """Get all active brands."""
    query = select(Brand).where(Brand.is_deleted == False)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/brands", response_model=BrandResponse, status_code=status.HTTP_201_CREATED)
async def create_brand(
    brand_in: BrandCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    new_brand = Brand(**brand_in.model_dump())
    db.add(new_brand)
    await db.commit()
    await db.refresh(new_brand)
    return new_brand

@router.put("/brands/{brand_id}", response_model=BrandResponse)
async def update_brand(
    brand_id: UUID,
    brand_in: BrandUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    result = await db.execute(select(Brand).where(Brand.id == brand_id, Brand.is_deleted == False))
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    for k, v in brand_in.model_dump(exclude_unset=True).items():
        setattr(brand, k, v)
    await db.commit()
    await db.refresh(brand)
    return brand

@router.delete("/brands/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_brand(
    brand_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    result = await db.execute(select(Brand).where(Brand.id == brand_id, Brand.is_deleted == False))
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    brand.is_deleted = True
    await db.commit()

@router.get("/suppliers", response_model=List[SupplierResponse])
async def get_suppliers(db: AsyncSession = Depends(get_db)):
    """Get all active suppliers (for dropdown use)."""
    query = select(Supplier).where(Supplier.is_deleted == False)
    result = await db.execute(query)
    return result.scalars().all()

@router.get("/db-info")
async def get_db_info(db: AsyncSession = Depends(get_db)):
    from database import DATABASE_URL
    import os
    result = await db.execute(select(func.count(Product.id)))
    count = result.scalar()
    return {
        "DATABASE_URL": DATABASE_URL[:15] + "..." if DATABASE_URL else None,
        "product_count": count,
        "env_var": os.getenv("DATABASE_URL")[:15] + "..." if os.getenv("DATABASE_URL") else None
    }

@router.get("", response_model=PaginatedProductResponse)
@cache(expire=60)
async def get_products(
    supplier_id: Optional[UUID] = None,
    category_id: Optional[UUID] = None,
    stock_status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """
    Get products, optionally filtered by search term (sku, barcode, name), with pagination.
    """
    base_query = select(Product).where(Product.is_deleted == False)
    
    if supplier_id:
        base_query = base_query.where(Product.supplier_id == supplier_id)
        
    if category_id:
        base_query = base_query.where(Product.category_id == category_id)

    if stock_status:
        stock_sum = select(func.coalesce(func.sum(InventoryBalance.current_stock), 0)).where(InventoryBalance.product_id == Product.id).scalar_subquery()
        if stock_status == "critical":
            base_query = base_query.where(stock_sum <= 0)
        elif stock_status == "low":
            base_query = base_query.where(
                and_(
                    stock_sum > 0,
                    or_(
                        and_(Product.min_stock_level > 0, stock_sum <= Product.min_stock_level),
                        and_(Product.min_stock_level == 0, stock_sum < 5)
                    )
                )
            )

    if search:
        search_pattern = f"%{search}%"
        base_query = base_query.where(
            (Product.sku.ilike(search_pattern)) | 
            (Product.barcode.ilike(search_pattern)) | 
            (Product.name_en.ilike(search_pattern)) |
            (Product.name_ar.ilike(search_pattern))
        )
    
    # Get total count
    count_query = select(func.count(Product.id)).select_from(base_query.subquery())
    result_count = await db.execute(count_query)
    total_count = result_count.scalar() or 0

    # Get data
    query = base_query.options(
        selectinload(Product.units).selectinload(ProductUnit.prices),
        selectinload(Product.category),
        selectinload(Product.bundle_components)
    ).offset(skip).limit(limit)
    
    result = await db.execute(query)
    products = result.scalars().unique().all()
    
    return {"data": products, "total": total_count}

@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Get a specific product by ID with its units and prices.
    """
    query = select(Product).where(Product.id == product_id, Product.is_deleted == False).options(
        selectinload(Product.units).selectinload(ProductUnit.prices),
        selectinload(Product.category),
        selectinload(Product.bundle_components)
    )
    result = await db.execute(query)
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    # Get current stock
    stock_query = select(func.sum(InventoryBalance.current_stock)).where(InventoryBalance.product_id == product_id)
    stock_result = await db.execute(stock_query)
    current_stock = stock_result.scalar_one_or_none() or 0
    
    # We can inject current_stock for Pydantic to pick it up
    setattr(product, "current_stock", current_stock)
    
    return product

from models.product import Product, ProductUnit, ProductPrice, Category, Subcategory, Brand, Supplier, ProductBundleComponent

@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    product_in: ProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    """
    Create a new product with multiple units, prices, and optionally bundle components.
    """
    try:
        # Create Product
        product_dict = product_in.model_dump(exclude={"units", "initial_stock", "bundle_components"})
        
        if not product_dict.get("barcode"):
            product_dict["barcode"] = None
            
        # Ensure SKU is truly unique even if frontend sends a collision
        if not product_dict.get("sku") or str(product_dict.get("sku")).startswith("INV-"):
            product_dict["sku"] = f"INV-{uuid.uuid4().hex[:8].upper()}"
            
        new_product = Product(**product_dict)
        db.add(new_product)
        await db.flush() # To get new_product.id
        
        units_response = []
        bundle_comps_response = []
        # Create Units and Prices
        for unit_in in product_in.units:
            unit_dict = unit_in.model_dump(exclude={"prices"})
            if not unit_dict.get("barcode") or str(unit_dict.get("barcode")).startswith("SKU-001-"):
                unit_dict["barcode"] = f"UNIT-{uuid.uuid4().hex[:8].upper()}"
                
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
                prices_response.append(new_price.__dict__.copy())
                
            unit_res = new_unit.__dict__.copy()
            unit_res["prices"] = prices_response
            units_response.append(unit_res)
            
        # Create Bundle Components
        if product_in.is_bundle and product_in.bundle_components:
            for comp_in in product_in.bundle_components:
                new_comp = ProductBundleComponent(
                    bundle_id=new_product.id,
                    component_id=comp_in.component_id,
                    quantity=comp_in.quantity
                )
                db.add(new_comp)
                await db.flush()
                bundle_comps_response.append(new_comp.__dict__.copy())
            
        # Audit Log
        audit = AuditLog(
            user_id=current_user.id,
            action="CREATE_PRODUCT",
            entity_type="Product",
            entity_id=str(new_product.id),
            new_value=product_in.model_dump(mode='json')
        )
        db.add(audit)
        
        # Handle initial stock if provided
        if product_in.initial_stock > 0:
            from models.inventory import Warehouse, InventoryBalance, InventoryTransaction, TransactionTypeEnum
            first_warehouse_query = select(Warehouse).limit(1)
            first_warehouse_result = await db.execute(first_warehouse_query)
            first_warehouse = first_warehouse_result.scalar_one_or_none()
            
            if not first_warehouse:
                first_warehouse = Warehouse(name="المخزن الرئيسي", location="الفرع الرئيسي")
                db.add(first_warehouse)
                await db.flush()
                
            if first_warehouse:
                # Create Balance
                balance = InventoryBalance(
                    product_id=new_product.id,
                    warehouse_id=first_warehouse.id,
                    current_stock=product_in.initial_stock
                )
                db.add(balance)
                
                # Create Transaction
                transaction = InventoryTransaction(
                    product_id=new_product.id,
                    warehouse_id=first_warehouse.id,
                    user_id=current_user.id,
                    transaction_type=TransactionTypeEnum.RECEIVING,
                    quantity_changed=product_in.initial_stock,
                    notes="Initial stock from product creation"
                )
                db.add(transaction)

        await db.commit()
    except Exception as e:
        await db.rollback()
        # Usually IntegrityError, but we catch Exception to be safe
        error_msg = str(e)
        if "UniqueViolationError" in error_msg or "duplicate key value" in error_msg:
            raise HTTPException(status_code=400, detail=f"Duplicate value error: A product or unit with this barcode/sku already exists.")
        raise HTTPException(status_code=400, detail=f"Database error: {error_msg}")
    
    p_dict = new_product.__dict__.copy()
    p_dict["units"] = units_response
    return p_dict

@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    product_in: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
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
    if product_in.units is not None:
        # Hard delete old prices and units
        await db.execute(
            delete(ProductPrice).where(ProductPrice.product_id == product_id)
        )
        await db.execute(
            delete(ProductUnit).where(ProductUnit.product_id == product_id)
        )
        await db.flush()
        
        # Add new ones
        for unit_in in product_in.units:
            unit_dict = unit_in.model_dump(exclude={"prices"})
            unit_dict["id"] = uuid.uuid4()
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
                
    # Handle manual stock adjustment from edit screen
    if product_in.total_stock is not None:
        stock_query = select(InventoryBalance).where(InventoryBalance.product_id == product_id)
        stock_result = await db.execute(stock_query)
        balances = stock_result.scalars().all()
        
        main_wh_query = select(Warehouse).where(Warehouse.name == "Main Warehouse")
        main_wh_result = await db.execute(main_wh_query)
        main_wh = main_wh_result.scalar_one_or_none()
        
        if not main_wh:
            main_wh = Warehouse(name="Main Warehouse", location="Default")
            db.add(main_wh)
            await db.flush()
            
        from decimal import Decimal
        current_total = Decimal(sum([b.current_stock for b in balances]))
        diff = product_in.total_stock - current_total
        
        if diff != Decimal("0"):
            main_balance = next((b for b in balances if b.warehouse_id == main_wh.id), None)
            if not main_balance:
                main_balance = InventoryBalance(
                    product_id=product_id,
                    warehouse_id=main_wh.id,
                    current_stock=Decimal("0")
                )
                db.add(main_balance)
                await db.flush()
                
            main_balance.current_stock = main_balance.current_stock + diff
            
            tx = InventoryTransaction(
                product_id=product_id,
                warehouse_id=main_wh.id,
                user_id=current_user.id,
                transaction_type=TransactionTypeEnum.ADJUSTMENT,
                quantity_changed=diff,
                notes="Manual adjustment from product edit screen"
            )
            db.add(tx)

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
    
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        error_msg = str(e)
        if "UniqueViolationError" in error_msg or "duplicate key value" in error_msg:
            raise HTTPException(status_code=400, detail=f"Duplicate value error: A product or unit with this barcode/sku already exists.")
        raise HTTPException(status_code=400, detail=f"Database error: {error_msg}")
    
    # Re-fetch or reconstruct response
    return await get_product(product_id, db)

@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
):
    """
    Soft-delete a product.
    """
    query = select(Product).where(Product.id == product_id, Product.is_deleted == False)
    result = await db.execute(query)
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    product.is_deleted = True
    
    # Audit Log
    audit = AuditLog(
        user_id=current_user.id,
        action="DELETE_PRODUCT",
        entity_type="Product",
        entity_id=str(product.id),
        old_value={"id": str(product.id), "sku": product.sku, "name_en": product.name_en},
        new_value={"is_deleted": True}
    )
    db.add(audit)
    
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")

