from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import update, func, delete, or_, and_
from sqlalchemy.exc import IntegrityError
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
from core.dependencies import get_current_user, require_admin, require_basic_staff_access, require_inventory_access
from core.product_access import visible_product
from database import get_db

router = APIRouter(prefix="/products", tags=["Products"], dependencies=[Depends(require_basic_staff_access)])

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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
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
    current_user: User = Depends(require_inventory_access),
):
    result = await db.execute(select(Brand).where(Brand.id == brand_id, Brand.is_deleted == False))
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    brand.is_deleted = True
    await db.commit()

@router.get("/suppliers", response_model=List[SupplierResponse])
async def get_suppliers(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_inventory_access)):
    """Get all active suppliers (for dropdown use)."""
    query = select(Supplier).where(Supplier.is_deleted == False)
    result = await db.execute(query)
    from core.supplier_access import visible_supplier
    return [visible_supplier(supplier, current_user.role) for supplier in result.scalars().all()]

@router.get("/db-info")
async def get_db_info(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_admin)):
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
async def get_products(
    supplier_id: Optional[UUID] = None,
    category_id: Optional[UUID] = None,
    stock_status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_basic_staff_access),
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
    count_query = select(func.count()).select_from(base_query.subquery())
    result_count = await db.execute(count_query)
    total_count = result_count.scalar() or 0

    # Get data
    query = base_query.options(
        selectinload(Product.units.and_(ProductUnit.is_deleted == False)).selectinload(ProductUnit.prices),
        selectinload(Product.category),
        selectinload(Product.bundle_components)
    ).offset(skip).limit(limit)
    
    result = await db.execute(query)
    products = result.scalars().unique().all()
    
    return {"data": [visible_product(product, current_user.role) for product in products], "total": total_count}

from services.product_service import ProductService

@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_basic_staff_access)):
    """
    Get a specific product by ID with its units and prices.
    """
    product = await ProductService.get_product(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    return visible_product(product, current_user.role)

from models.product import Product, ProductUnit, ProductPrice, Category, Subcategory, Brand, Supplier, ProductBundleComponent

@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    product_in: ProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Create a new product with multiple units, prices, and optionally bundle components.
    """
    try:
        p_dict = await ProductService.create_product(db, product_in, current_user.id)
        return p_dict
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    product_in: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Update a product. For simplicity, units and prices replacement strategy can be used.
    """
    try:
        updated_product = await ProductService.update_product(db, product_id, product_in, current_user.id)
        if not updated_product:
            raise HTTPException(status_code=404, detail="Product not found")
        return updated_product
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """
    Soft-delete a product.
    """
    success = await ProductService.delete_product(db, product_id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Product not found")

