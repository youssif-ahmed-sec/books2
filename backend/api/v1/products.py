from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import update, func, delete, or_, and_
from sqlalchemy.exc import IntegrityError
from uuid import UUID
import uuid
from typing import List, Optional
from models.product import Product, ProductUnit, ProductPrice, ProductBundleComponent, Category, Subcategory, Brand, Supplier
from models.user import AuditLog, User
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse, TransactionTypeEnum
from schemas.product import (
    ProductCreate, ProductUpdate, ProductResponse, CategoryResponse, CategoryCreate, CategoryUpdate,
    SubcategoryResponse, SubcategoryCreate, SubcategoryUpdate,
    BrandResponse, BrandCreate, BrandUpdate,
    SupplierResponse, PaginatedProductResponse
)
from core.reference_cache import cached_reference, invalidate_reference
from core.dependencies import get_current_user, require_admin, require_basic_staff_access, require_inventory_access
from core.product_access import visible_product
from database import get_db

router = APIRouter(prefix="/products", tags=["Products"], dependencies=[Depends(require_basic_staff_access)])

@router.get("/categories", response_model=List[CategoryResponse])
async def get_categories(db: AsyncSession = Depends(get_db)):
    """Get all active categories."""
    async def load():
        result = await db.execute(select(Category).where(Category.is_deleted == False))
        return [CategoryResponse.model_validate(row).model_dump(mode="json") for row in result.scalars().all()]
    return await cached_reference("categories", load)

@router.post("/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    category_in: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    new_cat = Category(**category_in.model_dump())
    db.add(new_cat)
    await db.flush()
    db.add(AuditLog(user_id=current_user.id, action="CREATE_CATEGORY", entity_type="Category", entity_id=str(new_cat.id)))
    await db.commit()
    await invalidate_reference("categories")
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
    db.add(AuditLog(user_id=current_user.id, action="UPDATE_CATEGORY", entity_type="Category", entity_id=str(category_id)))
    await db.commit()
    await invalidate_reference("categories")
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
    db.add(AuditLog(user_id=current_user.id, action="ARCHIVE_CATEGORY", entity_type="Category", entity_id=str(category_id)))
    await db.commit()
    await invalidate_reference("categories")

@router.get("/subcategories", response_model=List[SubcategoryResponse])
async def get_subcategories(db: AsyncSession = Depends(get_db)):
    """Get all active subcategories."""
    async def load():
        result = await db.execute(select(Subcategory).where(Subcategory.is_deleted == False))
        return [SubcategoryResponse.model_validate(row).model_dump(mode="json") for row in result.scalars().all()]
    return await cached_reference("subcategories", load)

@router.post("/subcategories", response_model=SubcategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_subcategory(
    sub_in: SubcategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    new_sub = Subcategory(**sub_in.model_dump())
    db.add(new_sub)
    await db.flush()
    db.add(AuditLog(user_id=current_user.id, action="CREATE_SUBCATEGORY", entity_type="Subcategory", entity_id=str(new_sub.id)))
    await db.commit()
    await invalidate_reference("subcategories")
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
    db.add(AuditLog(user_id=current_user.id, action="UPDATE_SUBCATEGORY", entity_type="Subcategory", entity_id=str(sub_id)))
    await db.commit()
    await invalidate_reference("subcategories")
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
    db.add(AuditLog(user_id=current_user.id, action="ARCHIVE_SUBCATEGORY", entity_type="Subcategory", entity_id=str(sub_id)))
    await db.commit()
    await invalidate_reference("subcategories")

@router.get("/brands", response_model=List[BrandResponse])
async def get_brands(db: AsyncSession = Depends(get_db)):
    """Get all active brands."""
    async def load():
        result = await db.execute(select(Brand).where(Brand.is_deleted == False))
        return [BrandResponse.model_validate(row).model_dump(mode="json") for row in result.scalars().all()]
    return await cached_reference("brands", load)

@router.post("/brands", response_model=BrandResponse, status_code=status.HTTP_201_CREATED)
async def create_brand(
    brand_in: BrandCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    new_brand = Brand(**brand_in.model_dump())
    db.add(new_brand)
    await db.flush()
    db.add(AuditLog(user_id=current_user.id, action="CREATE_BRAND", entity_type="Brand", entity_id=str(new_brand.id)))
    await db.commit()
    await invalidate_reference("brands")
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
    db.add(AuditLog(user_id=current_user.id, action="UPDATE_BRAND", entity_type="Brand", entity_id=str(brand_id)))
    await db.commit()
    await invalidate_reference("brands")
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
    db.add(AuditLog(user_id=current_user.id, action="ARCHIVE_BRAND", entity_type="Brand", entity_id=str(brand_id)))
    await db.commit()
    await invalidate_reference("brands")

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
    is_bundle: Optional[bool] = None,
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

    if is_bundle is not None:
        base_query = base_query.where(Product.is_bundle == is_bundle)
    
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
            (Product.name_ar.ilike(search_pattern)) |
            (Product.id.in_(select(ProductUnit.product_id).where(
                ProductUnit.barcode.ilike(search_pattern), ProductUnit.is_deleted == False,
            )))
        )
    
    # Get total count
    count_query = select(func.count()).select_from(base_query.subquery())
    result_count = await db.execute(count_query)
    total_count = result_count.scalar() or 0

    # Get data
    query = base_query.options(
        selectinload(Product.units.and_(ProductUnit.is_deleted == False)).selectinload(ProductUnit.prices.and_(ProductPrice.is_deleted == False)),
        selectinload(Product.category),
        selectinload(Product.subcategory),
        selectinload(Product.brand),
        selectinload(Product.supplier),
        selectinload(Product.bundle_components.and_(ProductBundleComponent.is_deleted == False))
    ).offset(skip).limit(limit)
    
    result = await db.execute(query)
    products = result.scalars().unique().all()
    
    return {"data": [visible_product(product, current_user.role) for product in products], "total": total_count}

from services.product_service import ProductService

@router.get("/{product_id}/history")
async def get_product_history(
    product_id: UUID,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_inventory_access),
):
    if not (await db.execute(select(Product.id).where(Product.id == product_id, Product.is_deleted == False))).scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found")
    rows = (await db.execute(select(AuditLog).where(
        AuditLog.entity_type == "Product", AuditLog.entity_id == str(product_id),
    ).order_by(AuditLog.created_at.desc()).limit(min(max(limit, 1), 100)))).scalars().all()
    return [{"id": row.id, "action": row.action, "created_at": row.created_at,
             "user_id": row.user_id} for row in rows]

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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_admin),
):
    """
    Soft-delete a product.
    """
    try:
        success = await ProductService.delete_product(db, product_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not success:
        raise HTTPException(status_code=404, detail="Product not found")

