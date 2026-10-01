from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum
from models.order import Order, OrderItem, OrderStatusEnum, OrderSourceEnum
from models.product import Product, ProductPrice, ProductUnit, ProductBundleComponent
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate


class OrderService:
    @staticmethod
    def _build_order_dict(order, items):
        return {
            "id":              order.id,
            "customer_id":     order.customer_id,
            "user_id":         order.user_id,
            "assigned_to_id":  order.assigned_to_id,
            "status":          order.status.value if hasattr(order.status, "value") else order.status,
            "source":          (order.source.value if hasattr(order.source, "value") else order.source) if order.source else "Walk-In Customer",
            "total_amount":    float(order.total_amount),
            "tax_amount":      float(order.tax_amount),
            "discount_amount": float(order.discount_amount),
            "shipping_cost":   float(order.shipping_cost),
            "payment_method":  order.payment_method,
            "notes":           order.notes,
            "created_at":      order.created_at,
            "updated_at":      order.updated_at,
            "items": [
                {
                    "id":                 item.id,
                    "order_id":           item.order_id,
                    "product_id":         item.product_id,
                    "unit_id":            item.unit_id,
                    "quantity_requested": float(item.quantity_requested),
                    "quantity_actual":    float(item.quantity_actual),
                    "conversion_factor":  float(item.conversion_factor),
                    "price_level":        item.price_level,
                    "unit_price":         float(item.unit_price),
                    "total_price":        float(item.total_price),
                    "created_at":         item.created_at,
                }
                for item in items
            ],
        }

    @staticmethod
    async def create_order(db: AsyncSession, order_in: OrderCreate, current_user_id: UUID) -> dict:
        order = Order(
            customer_id=order_in.customer_id,
            user_id=current_user_id,
            status=order_in.status.value,
            source=order_in.source if hasattr(order_in, "source") and order_in.source else OrderSourceEnum.WALK_IN.value,
            discount_amount=Decimal(str(order_in.discount_amount)),
            shipping_cost=Decimal("0"),
            payment_method=order_in.payment_method,
            notes=order_in.notes,
            total_amount=Decimal("0"),
            tax_amount=Decimal("0"),
        )
        db.add(order)
        await db.flush()

        grand_total = Decimal("0")
        items_out = []

        for item_in in order_in.items:
            unit_q = await db.execute(
                select(ProductUnit).where(
                    ProductUnit.id == item_in.unit_id,
                    ProductUnit.product_id == item_in.product_id,
                    ProductUnit.is_deleted == False,
                )
            )
            unit = unit_q.scalar_one_or_none()
            if unit is None:
                await db.rollback()
                raise ValueError("Unit not found.")

            conversion_factor = Decimal(str(unit.conversion_factor))
            qty_requested     = Decimal(str(item_in.quantity))
            qty_actual        = qty_requested * conversion_factor

            price_q = await db.execute(
                select(ProductPrice).where(
                    ProductPrice.product_id == item_in.product_id,
                    ProductPrice.unit_id == item_in.unit_id,
                    ProductPrice.price_level == item_in.price_level.value,
                )
            )
            price_record = price_q.scalar_one_or_none()
            if not price_record:
                await db.rollback()
                raise ValueError("Price missing.")

            unit_price = Decimal(str(price_record.price))
            item_total = unit_price * qty_requested

            prod_q = await db.execute(select(Product).where(Product.id == item_in.product_id))
            product = prod_q.scalar_one_or_none()
            if product is None or product.is_deleted or not product.is_active:
                await db.rollback()
                raise ValueError("Product is not available for sale.")
            
            components_to_deduct = []
            if product.is_bundle:
                bundle_comps_q = await db.execute(select(ProductBundleComponent).where(ProductBundleComponent.bundle_id == product.id))
                bundle_comps = bundle_comps_q.scalars().all()
                if not bundle_comps:
                    await db.rollback()
                    raise ValueError("Bundle has no components.")
                for comp in bundle_comps:
                    components_to_deduct.append({
                        "product_id": comp.component_id,
                        "qty": qty_actual * Decimal(str(comp.quantity))
                    })
            else:
                components_to_deduct.append({
                    "product_id": item_in.product_id,
                    "qty": qty_actual
                })

            for comp_data in components_to_deduct:
                c_prod_id = comp_data["product_id"]
                c_qty = comp_data["qty"]
                
                DEFAULT_VIRTUAL_WAREHOUSE_ID = "00000000-0000-0000-0000-000000000000"
                if str(order_in.warehouse_id) == DEFAULT_VIRTUAL_WAREHOUSE_ID:
                    balance_q = await db.execute(
                        select(InventoryBalance)
                        .where(
                            InventoryBalance.product_id == c_prod_id,
                            InventoryBalance.current_stock >= c_qty
                        )
                        .order_by(InventoryBalance.current_stock.desc())
                        .limit(1)
                        .with_for_update()
                    )
                else:
                    balance_q = await db.execute(
                        select(InventoryBalance)
                        .where(
                            InventoryBalance.product_id == c_prod_id,
                            InventoryBalance.warehouse_id == order_in.warehouse_id,
                        )
                        .with_for_update()
                    )

                balance = balance_q.scalar_one_or_none()
                if not balance or Decimal(str(balance.current_stock)) < c_qty:
                    await db.rollback()
                    raise ValueError(f"Insufficient stock for product/component {c_prod_id}.")

                balance.current_stock = Decimal(str(balance.current_stock)) - c_qty
                db.add(InventoryTransaction(
                    product_id=c_prod_id,
                    warehouse_id=balance.warehouse_id,
                    user_id=current_user_id,
                    transaction_type=TransactionTypeEnum.ISSUING,
                    quantity_changed=-c_qty,
                    reference_document=str(order.id),
                    notes=f"POS Order #{order.id}",
                ))

            order_item = OrderItem(
                order_id=order.id,
                product_id=item_in.product_id,
                unit_id=item_in.unit_id,
                quantity_requested=qty_requested,
                quantity_actual=qty_actual,
                conversion_factor=conversion_factor,
                price_level=item_in.price_level.value,
                unit_price=unit_price,
                total_price=item_total,
            )
            db.add(order_item)
            await db.flush()

            grand_total += item_total
            items_out.append(order_item)

        if Decimal(str(order_in.discount_amount)) > grand_total:
            await db.rollback()
            raise ValueError("Discount cannot exceed the order subtotal.")
        order.total_amount = grand_total - Decimal(str(order_in.discount_amount))
        await db.commit()
        await db.refresh(order)
        return OrderService._build_order_dict(order, items_out)

    @staticmethod
    async def create_draft_order(db: AsyncSession, order_in: OrderDraftCreate, current_user_id: UUID) -> dict:
        order = Order(
            customer_id=order_in.customer_id,
            user_id=current_user_id,
            assigned_to_id=order_in.assigned_to_id,
            status=order_in.status.value,
            source=order_in.source.value,
            discount_amount=Decimal(str(order_in.discount_amount)),
            shipping_cost=Decimal(str(order_in.shipping_cost)),
            payment_method=order_in.payment_method,
            notes=order_in.notes,
            total_amount=Decimal("0"),
            tax_amount=Decimal("0"),
        )
        db.add(order)
        await db.flush()

        grand_total = Decimal("0")
        items_out = []

        for item_in in order_in.items:
            unit_q = await db.execute(
                select(ProductUnit).where(
                    ProductUnit.id == item_in.unit_id,
                    ProductUnit.product_id == item_in.product_id,
                    ProductUnit.is_deleted == False,
                )
            )
            unit = unit_q.scalar_one_or_none()
            if not unit:
                await db.rollback()
                raise ValueError("Unit not found.")

            product_q = await db.execute(select(Product).where(
                Product.id == item_in.product_id,
                Product.is_deleted == False,
                Product.is_active == True,
            ))
            if product_q.scalar_one_or_none() is None:
                await db.rollback()
                raise ValueError("Product is not available for sale.")

            conversion_factor = Decimal(str(unit.conversion_factor))
            qty_requested     = Decimal(str(item_in.quantity))
            qty_actual        = qty_requested * conversion_factor

            price_q = await db.execute(
                select(ProductPrice).where(
                    ProductPrice.product_id == item_in.product_id,
                    ProductPrice.unit_id == item_in.unit_id,
                    ProductPrice.price_level == item_in.price_level.value,
                )
            )
            price_record = price_q.scalar_one_or_none()
            if not price_record:
                await db.rollback()
                raise ValueError(f"Price missing for {item_in.price_level.value}.")

            unit_price = Decimal(str(price_record.price))
            item_total = unit_price * qty_requested

            order_item = OrderItem(
                order_id=order.id,
                product_id=item_in.product_id,
                unit_id=item_in.unit_id,
                quantity_requested=qty_requested,
                quantity_actual=qty_actual,
                conversion_factor=conversion_factor,
                price_level=item_in.price_level.value,
                unit_price=unit_price,
                total_price=item_total,
            )
            db.add(order_item)
            await db.flush()

            grand_total += item_total
            items_out.append(order_item)

        if Decimal(str(order_in.discount_amount)) > grand_total + Decimal(str(order_in.shipping_cost)):
            await db.rollback()
            raise ValueError("Discount cannot exceed the order total.")
        order.total_amount = grand_total + Decimal(str(order_in.shipping_cost)) - Decimal(str(order_in.discount_amount))
        await db.commit()
        await db.refresh(order)
        return OrderService._build_order_dict(order, items_out)

    @staticmethod
    async def update_order_status(db: AsyncSession, order_id: UUID, status_update: OrderStatusUpdate, current_user_id: UUID) -> dict:
        order_q = await db.execute(select(Order).where(Order.id == order_id).with_for_update())
        order = order_q.scalar_one_or_none()
        if not order:
            return None

        new_status = status_update.status.value
        old_status = order.status

        fulfilled = {OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value}
        if old_status in fulfilled and new_status not in fulfilled:
            raise ValueError("A fulfilled order needs a separate return or refund workflow before changing status.")

        if new_status in fulfilled:
            if old_status not in fulfilled:
                issued_q = await db.execute(
                    select(InventoryTransaction.id).where(
                        InventoryTransaction.reference_document == str(order.id),
                        InventoryTransaction.transaction_type == TransactionTypeEnum.ISSUING,
                    ).limit(1)
                )
                if issued_q.scalar_one_or_none() is None:
                    if not status_update.warehouse_id:
                        raise ValueError("warehouse_id is required to deliver/close.")

                    await OrderService._deduct_order_stock(db, order, status_update.warehouse_id, current_user_id)

        order.status = new_status
        await db.commit()
        await db.refresh(order)

        items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        items_out = items_q.scalars().all()
        return OrderService._build_order_dict(order, items_out)

    @staticmethod
    async def _deduct_order_stock(db: AsyncSession, order: Order, warehouse_id: UUID, current_user_id: UUID) -> None:

        items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        items = items_q.scalars().all()

        for item in items:
            prod_q = await db.execute(select(Product).where(Product.id == item.product_id))
            product = prod_q.scalar_one_or_none()
            if product is None or product.is_deleted:
                await db.rollback()
                raise ValueError("Order product is no longer available for delivery.")

            components_to_deduct = []
            if product.is_bundle:
                bundle_comps_q = await db.execute(select(ProductBundleComponent).where(ProductBundleComponent.bundle_id == product.id))
                bundle_comps = bundle_comps_q.scalars().all()
                if not bundle_comps:
                    await db.rollback()
                    raise ValueError("Bundle has no components.")
                for comp in bundle_comps:
                    components_to_deduct.append({
                        "product_id": comp.component_id,
                        "qty": Decimal(str(item.quantity_actual)) * Decimal(str(comp.quantity))
                    })
            else:
                components_to_deduct.append({
                    "product_id": item.product_id,
                    "qty": Decimal(str(item.quantity_actual))
                })

            for comp_data in components_to_deduct:
                c_prod_id = comp_data["product_id"]
                c_qty = comp_data["qty"]

                balance_q = await db.execute(
                    select(InventoryBalance)
                    .where(
                        InventoryBalance.product_id == c_prod_id,
                        InventoryBalance.warehouse_id == warehouse_id,
                    )
                    .with_for_update()
                )
                balance = balance_q.scalar_one_or_none()
                if not balance or Decimal(str(balance.current_stock)) < c_qty:
                    await db.rollback()
                    raise ValueError(f"Insufficient stock for delivery of component {c_prod_id}.")

                balance.current_stock = Decimal(str(balance.current_stock)) - c_qty
                db.add(InventoryTransaction(
                    product_id=c_prod_id,
                    warehouse_id=warehouse_id,
                    user_id=current_user_id,
                    transaction_type=TransactionTypeEnum.ISSUING,
                    quantity_changed=-c_qty,
                    reference_document=str(order.id),
                    notes=f"Order {order.id} Delivered",
                ))


    @staticmethod
    async def get_orders(db: AsyncSession, status: Optional[str] = None, source: Optional[str] = None, customer_id: Optional[UUID] = None) -> List[dict]:
        query = select(Order).order_by(Order.created_at.desc())
        if status:
            query = query.where(Order.status == status)
        if source:
            query = query.where(Order.source == source)
        if customer_id:
            query = query.where(Order.customer_id == customer_id)

        orders_q = await db.execute(query)
        orders = orders_q.scalars().all()

        results = []
        for order in orders:
            items_q = await db.execute(
                select(OrderItem).where(OrderItem.order_id == order.id)
            )
            items = items_q.scalars().all()
            results.append(OrderService._build_order_dict(order, items))

        return results

    @staticmethod
    async def get_order(db: AsyncSession, order_id: UUID) -> Optional[dict]:
        order_q = await db.execute(select(Order).where(Order.id == order_id))
        order = order_q.scalar_one_or_none()
        if not order:
            return None

        items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        items = items_q.scalars().all()
        
        return OrderService._build_order_dict(order, items)
