import uuid
from decimal import Decimal
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func
from sqlalchemy.orm import selectinload

from models.product import Product, ProductUnit, ProductPrice, ProductBundleComponent, Category, Subcategory, Brand, Supplier
from models.user import AuditLog
from schemas.product import ProductCreate, ProductUpdate
from models.inventory import Warehouse, InventoryBalance, TransactionTypeEnum
from models.purchase import PurchaseOrder
from services.inventory_service import InventoryService


class ProductService:
    @staticmethod
    async def validate_catalog_links(db: AsyncSession, category_id, subcategory_id, brand_id, supplier_id) -> None:
        if not all((category_id, subcategory_id, brand_id, supplier_id)):
            raise ValueError("Category, subcategory, primary supplier and brand are required")
        checks = ((Category, category_id, "Category"), (Brand, brand_id, "Brand"), (Supplier, supplier_id, "Primary supplier"))
        for model, record_id, label in checks:
            found = (await db.execute(select(model.id).where(model.id == record_id, model.is_deleted == False))).scalar_one_or_none()
            if found is None:
                raise ValueError(f"{label} is unavailable")
        subcategory = (await db.execute(select(Subcategory).where(
            Subcategory.id == subcategory_id, Subcategory.is_deleted == False,
        ))).scalar_one_or_none()
        if subcategory is None or subcategory.category_id != category_id:
            raise ValueError("Subcategory must belong to the selected category")


    @staticmethod
    async def validate_bundle_components(db: AsyncSession, bundle_id: uuid.UUID, components) -> None:
        if not components:
            raise ValueError("An offer needs at least one component")
        for component in components:
            if component.component_id == bundle_id:
                raise ValueError("An offer cannot contain itself")
            item = (await db.execute(select(Product).where(
                Product.id == component.component_id, Product.is_deleted == False,
                Product.is_active == True, Product.is_bundle == False,
            ))).scalar_one_or_none()
            if item is None:
                raise ValueError("Offer component is unavailable or is another offer")
            if component.unit_id is None:
                if component.price_level is not None:
                    raise ValueError("Offer price level requires a component unit")
                continue  # Existing clients store quantities in base units.
            unit = (await db.execute(select(ProductUnit).where(
                ProductUnit.id == component.unit_id,
                ProductUnit.product_id == component.component_id,
                ProductUnit.is_deleted == False,
            ))).scalar_one_or_none()
            if unit is None or component.price_level is None:
                raise ValueError("Choose an active unit and price level for each offer component")
            if Decimal(str(component.quantity)) % Decimal(str(unit.conversion_factor)) != 0:
                raise ValueError("Offer component quantity must be a whole number of selected units")
            price = (await db.execute(select(ProductPrice.id).where(
                ProductPrice.unit_id == unit.id,
                ProductPrice.price_level == component.price_level,
                ProductPrice.is_deleted == False,
            ).limit(1))).scalar_one_or_none()
            if price is None:
                raise ValueError("Selected offer component price is unavailable")
    
    @staticmethod
    async def get_product(db: AsyncSession, product_id: uuid.UUID) -> Optional[Product]:
        query = select(Product).where(Product.id == product_id, Product.is_deleted == False).options(
            selectinload(Product.units.and_(ProductUnit.is_deleted == False)).selectinload(ProductUnit.prices.and_(ProductPrice.is_deleted == False)),
            selectinload(Product.category),
            selectinload(Product.subcategory),
            selectinload(Product.brand),
            selectinload(Product.supplier),
            selectinload(Product.bundle_components.and_(ProductBundleComponent.is_deleted == False))
        )
        result = await db.execute(query)
        product = result.scalar_one_or_none()
        
        if not product:
            return None
            
        stock_query = select(func.sum(InventoryBalance.current_stock)).where(InventoryBalance.product_id == product_id)
        stock_result = await db.execute(stock_query)
        current_stock = stock_result.scalar_one_or_none() or 0
        
        setattr(product, "current_stock", current_stock)
        return product


    @staticmethod
    async def create_product(db: AsyncSession, product_in: ProductCreate, user_id: uuid.UUID) -> Dict[str, Any]:
        await ProductService.validate_catalog_links(db, product_in.category_id, product_in.subcategory_id, product_in.brand_id, product_in.supplier_id)
        if product_in.is_bundle and product_in.initial_stock > 0:
            raise ValueError("An offer uses component stock and cannot have its own initial stock")
        try:
            product_dict = product_in.model_dump(exclude={"units", "initial_stock", "bundle_components"})
            product_dict["name_en"] = (product_dict.get("name_en") or "").strip()
            
            if not product_dict.get("barcode"):
                product_dict["barcode"] = None
                
            if not product_dict.get("sku") or str(product_dict.get("sku")).startswith("INV-"):
                product_dict["sku"] = f"INV-{uuid.uuid4().hex[:8].upper()}"
                
            new_product = Product(**product_dict)
            db.add(new_product)
            await db.flush() 
            
            units_response = []
            bundle_comps_response = []
            
            for unit_in in product_in.units:
                unit_dict = unit_in.model_dump(exclude={"prices", "id"})
                if not unit_dict.get("barcode") or str(unit_dict.get("barcode")).startswith("SKU-001-"):
                    unit_dict["barcode"] = f"UNIT-{uuid.uuid4().hex[:8].upper()}"
                    
                new_unit = ProductUnit(product_id=new_product.id, **unit_dict)
                db.add(new_unit)
                await db.flush() 
                
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
                
            if product_in.is_bundle:
                await ProductService.validate_bundle_components(db, new_product.id, product_in.bundle_components)
                for comp_in in product_in.bundle_components:
                    new_comp = ProductBundleComponent(
                        bundle_id=new_product.id,
                        component_id=comp_in.component_id,
                        quantity=comp_in.quantity,
                        unit_id=comp_in.unit_id,
                        price_level=comp_in.price_level,
                    )
                    db.add(new_comp)
                    await db.flush()
                    bundle_comps_response.append(new_comp.__dict__.copy())
                
            audit = AuditLog(
                user_id=user_id,
                action="CREATE_PRODUCT",
                entity_type="Product",
                entity_id=str(new_product.id),
                new_value=product_in.model_dump(mode='json')
            )
            db.add(audit)
            
            if product_in.initial_stock > 0:
                first_warehouse_query = select(Warehouse).limit(1)
                first_warehouse_result = await db.execute(first_warehouse_query)
                first_warehouse = first_warehouse_result.scalar_one_or_none()
                
                if not first_warehouse:
                    first_warehouse = Warehouse(name="المخزن الرئيسي", location="الفرع الرئيسي")
                    db.add(first_warehouse)
                    await db.flush()
                    
                if first_warehouse:
                    balance = InventoryBalance(
                        product_id=new_product.id,
                        warehouse_id=first_warehouse.id,
                        current_stock=Decimal("0")
                    )
                    db.add(balance)
                    InventoryService.record_movement(
                        db, balance, product_in.initial_stock, user_id, TransactionTypeEnum.ADJUSTMENT,
                        notes="Initial stock from product creation"
                    )

            await db.commit()
        except IntegrityError as e:
            await db.rollback()
            raise ValueError("Duplicate value error: A product or unit with this barcode/sku already exists.")
        except Exception:
            await db.rollback()
            raise
        
        p_dict = new_product.__dict__.copy()
        p_dict["units"] = units_response
        p_dict["bundle_components"] = bundle_comps_response
        return p_dict


    @staticmethod
    async def update_product(db: AsyncSession, product_id: uuid.UUID, product_in: ProductUpdate, user_id: uuid.UUID) -> Optional[Product]:
        query = select(Product).where(Product.id == product_id, Product.is_deleted == False).with_for_update()
        result = await db.execute(query)
        product = result.scalar_one_or_none()
        
        if not product:
            return None
        await ProductService.validate_catalog_links(
            db,
            product_in.category_id if "category_id" in product_in.model_fields_set else product.category_id,
            product_in.subcategory_id if "subcategory_id" in product_in.model_fields_set else product.subcategory_id,
            product_in.brand_id if "brand_id" in product_in.model_fields_set else product.brand_id,
            product_in.supplier_id if "supplier_id" in product_in.model_fields_set else product.supplier_id,
        )
        if product_in.base_unit is not None and product_in.base_unit != product.base_unit:
            existing_stock = (await db.execute(select(func.coalesce(func.sum(InventoryBalance.current_stock), 0)).where(
                InventoryBalance.product_id == product_id,
            ))).scalar_one()
            if existing_stock != 0:
                raise ValueError("Base unit cannot change while the product has stock")
            
        old_value = {
            "sku": product.sku,
            "name_en": product.name_en,
            "cost": float(product.cost) if product.cost else 0
        }
            
        update_data = product_in.model_dump(exclude_unset=True, exclude={"units", "bundle_components"})
        if "name_en" in update_data:
            update_data["name_en"] = (update_data["name_en"] or "").strip()
        if "barcode" in update_data:
            update_data["barcode"] = (update_data["barcode"] or "").strip() or None
            if product.barcode and update_data["barcode"] != product.barcode:
                raise ValueError("A saved product barcode cannot be changed")
        
        for key, value in update_data.items():
            setattr(product, key, value)
            
        if product_in.units is not None:
            existing_query = select(ProductUnit).where(
                ProductUnit.product_id == product_id,
                ProductUnit.is_deleted == False,
            ).with_for_update()
            existing_units = {unit.id: unit for unit in (await db.execute(existing_query)).scalars().all()}
            submitted_ids = [unit.id for unit in product_in.units if unit.id is not None]
            if len(submitted_ids) != len(set(submitted_ids)) or any(unit_id not in existing_units for unit_id in submitted_ids):
                await db.rollback()
                raise ValueError("Unknown or repeated product unit ID.")
            for unit_in in product_in.units:
                if unit_in.id is None:
                    continue
                saved_barcode = existing_units[unit_in.id].barcode
                if saved_barcode and "barcode" in unit_in.model_fields_set and (unit_in.barcode or "").strip() != saved_barcode:
                    raise ValueError("A saved unit barcode cannot be changed")

            for unit_id, unit in existing_units.items():
                if unit_id not in submitted_ids:
                    unit.is_deleted = True

            existing_prices = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id).with_for_update())).scalars().all()
            prices_by_key = {(price.unit_id, price.price_level): price for price in existing_prices}
            for old_price in existing_prices:
                old_price.is_deleted = True
            
            for unit_in in product_in.units:
                unit_dict = unit_in.model_dump(exclude={"prices", "id"})
                if unit_in.id is not None:
                    new_unit = existing_units[unit_in.id]
                    unit_dict["barcode"] = new_unit.barcode or (unit_dict.get("barcode") or "").strip() or f"UNIT-{uuid.uuid4().hex[:8].upper()}"
                    for key, value in unit_dict.items():
                        setattr(new_unit, key, value)
                else:
                    unit_dict["barcode"] = (unit_dict.get("barcode") or "").strip() or f"UNIT-{uuid.uuid4().hex[:8].upper()}"
                    new_unit = ProductUnit(product_id=product_id, **unit_dict)
                    db.add(new_unit)
                await db.flush()
                
                for price_in in unit_in.prices:
                    price_dict = price_in.model_dump()
                    existing_price = prices_by_key.get((new_unit.id, price_in.price_level))
                    if existing_price is None:
                        db.add(ProductPrice(product_id=product_id, unit_id=new_unit.id, **price_dict))
                    else:
                        existing_price.price = price_in.price
                        existing_price.is_deleted = False

        if product_in.bundle_components is not None or product_in.is_bundle is False:
            existing_components = (await db.execute(select(ProductBundleComponent).where(
                ProductBundleComponent.bundle_id == product_id,
            ).with_for_update())).scalars().all()
            for old_component in existing_components:
                old_component.is_deleted = True
            if product.is_bundle:
                await ProductService.validate_bundle_components(db, product_id, product_in.bundle_components)
                for component in product_in.bundle_components:
                    db.add(ProductBundleComponent(
                        bundle_id=product_id, component_id=component.component_id,
                        quantity=component.quantity, unit_id=component.unit_id,
                        price_level=component.price_level,
                    ))
                    
        audit = AuditLog(
            user_id=user_id,
            action="UPDATE_PRODUCT",
            entity_type="Product",
            entity_id=str(product.id),
            old_value=old_value,
            new_value=product_in.model_dump(mode='json', exclude_unset=True)
        )
        db.add(audit)
        
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("Duplicate value error: A product or unit with this barcode/sku already exists.")
        except Exception:
            await db.rollback()
            raise
            
        return await ProductService.get_product(db, product_id)


    @staticmethod
    async def delete_product(db: AsyncSession, product_id: uuid.UUID, user_id: uuid.UUID, *, require_bundle: bool = False) -> bool:
        query = select(Product).where(Product.id == product_id, Product.is_deleted == False).with_for_update()
        result = await db.execute(query)
        product = result.scalar_one_or_none()
        
        if not product or (require_bundle and not product.is_bundle):
            return False

        stock = (await db.execute(select(func.coalesce(func.sum(InventoryBalance.current_stock), 0)).where(
            InventoryBalance.product_id == product_id,
        ))).scalar_one()
        if Decimal(str(stock)) != 0:
            raise ValueError("Cannot archive a product while it has warehouse stock")
        open_purchase = (await db.execute(select(PurchaseOrder.id).where(
            PurchaseOrder.product_id == product_id,
            PurchaseOrder.status.in_(("REQUESTED", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED")),
        ).limit(1))).scalar_one_or_none()
        if open_purchase is not None:
            raise ValueError("Cannot archive a product with an open purchase order")
            
        product.is_deleted = True
        
        audit = AuditLog(
            user_id=user_id,
            action="DELETE_PRODUCT",
            entity_type="Product",
            entity_id=str(product.id),
            old_value={"id": str(product.id), "sku": product.sku, "name_en": product.name_en},
            new_value={"is_deleted": True}
        )
        db.add(audit)
        
        try:
            await db.commit()
            return True
        except Exception:
            await db.rollback()
            raise
