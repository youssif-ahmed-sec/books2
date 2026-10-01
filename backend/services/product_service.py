import uuid
from decimal import Decimal
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy import delete
from sqlalchemy.sql import func
from sqlalchemy.orm import selectinload

from models.product import Product, ProductUnit, ProductPrice, ProductBundleComponent
from models.user import AuditLog
from schemas.product import ProductCreate, ProductUpdate
from models.inventory import Warehouse, InventoryBalance, InventoryTransaction, TransactionTypeEnum


class ProductService:
    
    @staticmethod
    async def get_product(db: AsyncSession, product_id: uuid.UUID) -> Optional[Product]:
        query = select(Product).where(Product.id == product_id, Product.is_deleted == False).options(
            selectinload(Product.units.and_(ProductUnit.is_deleted == False)).selectinload(ProductUnit.prices),
            selectinload(Product.category),
            selectinload(Product.bundle_components)
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
        try:
            product_dict = product_in.model_dump(exclude={"units", "initial_stock", "bundle_components"})
            
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
                        current_stock=product_in.initial_stock
                    )
                    db.add(balance)
                    
                    transaction = InventoryTransaction(
                        product_id=new_product.id,
                        warehouse_id=first_warehouse.id,
                        user_id=user_id,
                        transaction_type=TransactionTypeEnum.ADJUSTMENT,
                        quantity_changed=product_in.initial_stock,
                        notes="Initial stock from product creation"
                    )
                    db.add(transaction)

            await db.commit()
        except IntegrityError as e:
            await db.rollback()
            raise ValueError("Duplicate value error: A product or unit with this barcode/sku already exists.")
        except Exception:
            await db.rollback()
            raise
        
        p_dict = new_product.__dict__.copy()
        p_dict["units"] = units_response
        return p_dict


    @staticmethod
    async def update_product(db: AsyncSession, product_id: uuid.UUID, product_in: ProductUpdate, user_id: uuid.UUID) -> Optional[Product]:
        query = select(Product).where(Product.id == product_id, Product.is_deleted == False).with_for_update()
        result = await db.execute(query)
        product = result.scalar_one_or_none()
        
        if not product:
            return None
            
        old_value = {
            "sku": product.sku,
            "name_en": product.name_en,
            "cost": float(product.cost) if product.cost else 0
        }
            
        update_data = product_in.model_dump(exclude_unset=True, exclude={"units", "total_stock", "bundle_components"})
        
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

            for unit_id, unit in existing_units.items():
                if unit_id not in submitted_ids:
                    unit.is_deleted = True
                    unit.barcode = None

            await db.execute(delete(ProductPrice).where(ProductPrice.product_id == product_id))
            await db.flush()
            
            for unit_in in product_in.units:
                unit_dict = unit_in.model_dump(exclude={"prices", "id"})
                if unit_in.id is not None:
                    new_unit = existing_units[unit_in.id]
                    for key, value in unit_dict.items():
                        setattr(new_unit, key, value)
                else:
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

        if product_in.bundle_components is not None or product_in.is_bundle is False:
            await db.execute(delete(ProductBundleComponent).where(ProductBundleComponent.bundle_id == product_id))
            if product.is_bundle and product_in.bundle_components:
                for component in product_in.bundle_components:
                    db.add(ProductBundleComponent(
                        bundle_id=product_id,
                        component_id=component.component_id,
                        quantity=component.quantity,
                    ))
                    
        if product_in.total_stock is not None:
            stock_query = select(InventoryBalance).where(InventoryBalance.product_id == product_id).with_for_update()
            stock_result = await db.execute(stock_query)
            balances = stock_result.scalars().all()
            
            main_wh_query = select(Warehouse).where(Warehouse.name == "Main Warehouse")
            main_wh_result = await db.execute(main_wh_query)
            main_wh = main_wh_result.scalar_one_or_none()
            
            if not main_wh:
                main_wh = Warehouse(name="Main Warehouse", location="Default")
                db.add(main_wh)
                await db.flush()
                
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
                    
                if main_balance.current_stock + diff < 0:
                    await db.rollback()
                    raise ValueError("Stock reduction exceeds the main warehouse balance.")
                main_balance.current_stock = main_balance.current_stock + diff
                
                tx = InventoryTransaction(
                    product_id=product_id,
                    warehouse_id=main_wh.id,
                    user_id=user_id,
                    transaction_type=TransactionTypeEnum.ADJUSTMENT,
                    quantity_changed=diff,
                    notes="Manual adjustment from product edit screen"
                )
                db.add(tx)

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
    async def delete_product(db: AsyncSession, product_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        query = select(Product).where(Product.id == product_id, Product.is_deleted == False)
        result = await db.execute(query)
        product = result.scalar_one_or_none()
        
        if not product:
            return False
            
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
