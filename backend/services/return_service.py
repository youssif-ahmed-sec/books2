from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.idempotency import IdempotencyConflict, request_fingerprint
from models.customer import Customer
from models.financial import Payment
from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum, Warehouse
from models.order import Order, OrderItem, OrderStatusEnum
from models.product import Product, ProductBundleComponent, ProductPrice, ProductUnit
from models.returns import SalesReturn, SalesReturnLine
from models.user import AuditLog
from schemas.returns import SalesReturnCreate
from services.inventory_service import InventoryService
from services.notification_service import notify_low_stock_crossing
from services.order_service import OrderService
from services.cash_register_service import open_shift


MONEY = Decimal("0.01")


class ReturnService:
    @staticmethod
    async def process(db: AsyncSession, payload: SalesReturnCreate, user_id: UUID) -> SalesReturn:
        fingerprint = request_fingerprint(payload)
        existing = (await db.execute(select(SalesReturn).where(SalesReturn.id == payload.request_id))).scalar_one_or_none()
        if existing is not None:
            return ReturnService._replay(existing, fingerprint, user_id)
        try:
            return await ReturnService._process_once(db, payload, user_id, fingerprint)
        except IntegrityError:
            await db.rollback()
            existing = (await db.execute(select(SalesReturn).where(SalesReturn.id == payload.request_id))).scalar_one_or_none()
            if existing is None:
                raise
            return ReturnService._replay(existing, fingerprint, user_id)
        except Exception:
            await db.rollback()
            raise

    @staticmethod
    def _replay(existing: SalesReturn, fingerprint: str, user_id: UUID) -> SalesReturn:
        if existing.user_id != user_id or existing.request_fingerprint != fingerprint:
            raise IdempotencyConflict("Return request ID was already used differently.")
        return existing

    @staticmethod
    async def _balance(db: AsyncSession, product_id: UUID, warehouse_id: UUID) -> InventoryBalance:
        balance = (await db.execute(select(InventoryBalance).where(
            InventoryBalance.product_id == product_id,
            InventoryBalance.warehouse_id == warehouse_id,
        ).with_for_update())).scalar_one_or_none()
        if balance is None:
            balance = InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=0)
            db.add(balance)
            await db.flush()
        return balance

    @staticmethod
    async def preview(db: AsyncSession, payload: SalesReturnCreate, user_id: UUID) -> dict:
        """Quote the same discounted return lines and current replacement prices without writing."""
        order = (await db.execute(select(Order).where(Order.id == payload.order_id))).scalar_one_or_none()
        if order is None:
            raise ValueError("Original order not found.")
        if order.status not in (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value):
            raise ValueError("Only delivered orders can be returned.")
        if not order.payment_method:
            raise ValueError("Original order has no recorded payment method; settlement needs manual review.")
        sale_warehouses = (await db.execute(select(InventoryTransaction.warehouse_id).where(
            InventoryTransaction.reference_document == str(order.id),
            InventoryTransaction.transaction_type == TransactionTypeEnum.ISSUING,
        ).distinct())).scalars().all()
        if len(sale_warehouses) != 1 or sale_warehouses[0] != payload.warehouse_id:
            raise ValueError("Return must use the original issuing warehouse; split-warehouse sales need manual review.")
        warehouse = (await db.execute(select(Warehouse.id).where(
            Warehouse.id == payload.warehouse_id, Warehouse.is_active == True,
        ))).scalar_one_or_none()
        if warehouse is None:
            raise ValueError("Active return warehouse not found.")

        original_items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
        by_id = {item.id: item for item in original_items}
        subtotal = sum((Decimal(str(item.total_price)) for item in original_items), Decimal("0"))
        if subtotal <= 0:
            raise ValueError("Original order has no refundable items.")
        discount_factor = (subtotal - min(Decimal(str(order.discount_amount)), subtotal)) / subtotal
        returned_total = Decimal("0")
        for line in payload.lines:
            item = by_id.get(line.order_item_id)
            if item is None:
                raise ValueError("Return item does not belong to the original order.")
            if item.bundle_components_snapshot is None:
                raise ValueError("Legacy bundle needs component review before return.")
            already, already_amount = (await db.execute(select(
                func.coalesce(func.sum(SalesReturnLine.quantity), 0),
                func.coalesce(func.sum(SalesReturnLine.amount), 0),
            ).where(SalesReturnLine.order_item_id == item.id))).one()
            if Decimal(str(already)) + line.quantity > Decimal(str(item.quantity_requested)):
                raise ValueError("Return quantity exceeds the unreturned quantity.")
            discounted_line = (Decimal(str(item.total_price)) * discount_factor).quantize(MONEY, rounding=ROUND_HALF_UP)
            remaining_value = discounted_line - Decimal(str(already_amount))
            amount = remaining_value if Decimal(str(already)) + line.quantity == Decimal(str(item.quantity_requested)) else min(
                remaining_value,
                (Decimal(str(item.unit_price)) * line.quantity * discount_factor).quantize(MONEY, rounding=ROUND_HALF_UP),
            )
            returned_total += amount

        replacement_total = Decimal("0")
        if payload.replacements:
            await OrderService._check_pricing_policy(db, order.customer_id, payload.replacements, Decimal("0"), user_id)
            for replacement in payload.replacements:
                price = (await db.execute(select(ProductPrice).join(Product, Product.id == ProductPrice.product_id).join(
                    ProductUnit, ProductUnit.id == ProductPrice.unit_id,
                ).where(
                    ProductPrice.product_id == replacement.product_id,
                    ProductPrice.unit_id == replacement.unit_id,
                    ProductPrice.price_level == replacement.price_level.value,
                    ProductPrice.is_deleted == False,
                    Product.is_deleted == False, Product.is_active == True, ProductUnit.is_deleted == False,
                ))).scalar_one_or_none()
                if price is None or Decimal(str(price.price)) <= 0:
                    raise ValueError("Replacement product, unit, or price is unavailable.")
                replacement_total += (Decimal(str(price.price)) * replacement.quantity).quantize(MONEY, rounding=ROUND_HALF_UP)
        difference = replacement_total - returned_total
        return {
            "payment_method": order.payment_method,
            "returned_value": returned_total,
            "replacement_value": replacement_total,
            "refund_amount": max(-difference, Decimal("0")),
            "charge_amount": max(difference, Decimal("0")),
        }

    @staticmethod
    async def _process_once(db: AsyncSession, payload: SalesReturnCreate, user_id: UUID, fingerprint: str) -> SalesReturn:
        order = (await db.execute(select(Order).where(Order.id == payload.order_id).with_for_update())).scalar_one_or_none()
        if order is None:
            raise ValueError("Original order not found.")
        if order.status not in (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value):
            raise ValueError("Only delivered orders can be returned.")
        if not order.payment_method:
            raise ValueError("Original order has no recorded payment method; settlement needs manual review.")
        warehouse = (await db.execute(select(Warehouse).where(
            Warehouse.id == payload.warehouse_id, Warehouse.is_active == True,
        ).with_for_update())).scalar_one_or_none()
        if warehouse is None:
            raise ValueError("Active return warehouse not found.")
        sale_warehouses = (await db.execute(select(InventoryTransaction.warehouse_id).where(
            InventoryTransaction.reference_document == str(order.id),
            InventoryTransaction.transaction_type == TransactionTypeEnum.ISSUING,
        ).distinct())).scalars().all()
        if not sale_warehouses or len(sale_warehouses) != 1 or sale_warehouses[0] != payload.warehouse_id:
            raise ValueError("Return must use the original issuing warehouse; split-warehouse sales need manual review.")

        quote = await ReturnService.preview(db, payload, user_id)
        if ((payload.expected_refund_amount is not None and quote["refund_amount"] != payload.expected_refund_amount) or
                (payload.expected_charge_amount is not None and quote["charge_amount"] != payload.expected_charge_amount)):
            raise ValueError("Return settlement changed. Review the amounts before confirming again.")

        original_items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
        by_id = {item.id: item for item in original_items}
        subtotal = sum((Decimal(str(item.total_price)) for item in original_items), Decimal("0"))
        if subtotal <= 0:
            raise ValueError("Original order has no refundable items.")
        discount_factor = (subtotal - min(Decimal(str(order.discount_amount)), subtotal)) / subtotal

        result = SalesReturn(
            id=payload.request_id, order_id=order.id, warehouse_id=payload.warehouse_id,
            user_id=user_id, kind=payload.kind, payment_method=order.payment_method,
            request_fingerprint=fingerprint, refund_amount=0, charge_amount=0,
            returned_value=0, replacement_value=0,
        )
        db.add(result)
        await db.flush()

        returned_total = Decimal("0")
        for line in payload.lines:
            item = by_id.get(line.order_item_id)
            if item is None:
                raise ValueError("Return item does not belong to the original order.")
            already, already_amount = (await db.execute(select(
                func.coalesce(func.sum(SalesReturnLine.quantity), 0),
                func.coalesce(func.sum(SalesReturnLine.amount), 0),
            ).where(
                SalesReturnLine.order_item_id == item.id,
            ))).one()
            if Decimal(str(already)) + line.quantity > Decimal(str(item.quantity_requested)):
                raise ValueError("Return quantity exceeds the unreturned quantity.")
            discounted_line = (Decimal(str(item.total_price)) * discount_factor).quantize(MONEY, rounding=ROUND_HALF_UP)
            remaining_value = discounted_line - Decimal(str(already_amount))
            if Decimal(str(already)) + line.quantity == Decimal(str(item.quantity_requested)):
                amount = remaining_value
            else:
                amount = min(remaining_value, (Decimal(str(item.unit_price)) * line.quantity * discount_factor).quantize(MONEY, rounding=ROUND_HALF_UP))
            returned_total += amount
            db.add(SalesReturnLine(return_id=result.id, order_item_id=item.id, quantity=line.quantity, amount=amount))

            if item.bundle_components_snapshot is None:
                raise ValueError("Legacy bundle needs component review before return.")
            base_qty = line.quantity * Decimal(str(item.conversion_factor))
            components = item.bundle_components_snapshot if item.bundle_components_snapshot else [
                {"product_id": str(item.product_id), "quantity": "1"},
            ]
            for component in components:
                component_id = UUID(component["product_id"])
                quantity = base_qty * Decimal(str(component["quantity"]))
                balance = await ReturnService._balance(db, component_id, payload.warehouse_id)
                InventoryService.record_movement(
                    db, balance, quantity, user_id, TransactionTypeEnum.ADJUSTMENT,
                    reference_document=str(result.id), notes=f"Customer return from order {order.id}",
                )

        replacement_total = Decimal("0")
        exchange_order = None
        if payload.replacements:
            await OrderService._check_pricing_policy(db, order.customer_id, payload.replacements, Decimal("0"), user_id)
            exchange_order = Order(
                customer_id=order.customer_id, user_id=user_id, status=OrderStatusEnum.DELIVERED.value,
                source=order.source, payment_method=order.payment_method,
                total_amount=0, tax_amount=0, discount_amount=0, shipping_cost=0,
                notes=f"Exchange for order {order.id}",
            )
            db.add(exchange_order)
            await db.flush()
            exchange_items = []
            for replacement in payload.replacements:
                unit = (await db.execute(select(ProductUnit).where(
                    ProductUnit.id == replacement.unit_id,
                    ProductUnit.product_id == replacement.product_id,
                    ProductUnit.is_deleted == False,
                ))).scalar_one_or_none()
                product = (await db.execute(select(Product).where(
                    Product.id == replacement.product_id, Product.is_deleted == False, Product.is_active == True,
                ))).scalar_one_or_none()
                price = (await db.execute(select(ProductPrice).where(
                    ProductPrice.product_id == replacement.product_id,
                    ProductPrice.unit_id == replacement.unit_id,
                    ProductPrice.price_level == replacement.price_level.value,
                    ProductPrice.is_deleted == False,
                ))).scalar_one_or_none()
                if unit is None or product is None or price is None:
                    raise ValueError("Replacement product, unit, or price is unavailable.")
                if Decimal(str(price.price)) <= 0:
                    raise ValueError("Replacement price must be greater than zero.")
                base_qty = replacement.quantity * Decimal(str(unit.conversion_factor))
                components = []
                if product.is_bundle:
                    parts = (await db.execute(select(ProductBundleComponent).where(
                        ProductBundleComponent.bundle_id == product.id, ProductBundleComponent.is_deleted == False,
                    ))).scalars().all()
                    if not parts:
                        raise ValueError("Replacement bundle has no components.")
                    components = [{"product_id": str(part.component_id), "quantity": str(part.quantity)} for part in parts]
                else:
                    components = [{"product_id": str(product.id), "quantity": "1"}]
                cost = Decimal("0")
                for component in components:
                    component_id = UUID(component["product_id"])
                    quantity = base_qty * Decimal(component["quantity"])
                    balance = await ReturnService._balance(db, component_id, payload.warehouse_id)
                    if Decimal(str(balance.current_stock)) < quantity:
                        raise ValueError("Insufficient stock for exchange item.")
                    component_product = (await db.execute(select(Product).where(Product.id == component_id))).scalar_one()
                    stock_before = Decimal(str(balance.current_stock))
                    InventoryService.record_movement(
                        db, balance, -quantity, user_id, TransactionTypeEnum.ISSUING,
                        reference_document=str(exchange_order.id), notes=f"Exchange for return {result.id}",
                    )
                    await notify_low_stock_crossing(db, component_product, stock_before, balance.current_stock)
                    cost += Decimal(str(component_product.cost or 0)) * quantity
                total = (Decimal(str(price.price)) * replacement.quantity).quantize(MONEY, rounding=ROUND_HALF_UP)
                replacement_total += total
                exchange_item = OrderItem(
                    order_id=exchange_order.id, product_id=product.id, unit_id=unit.id,
                    quantity_requested=replacement.quantity, quantity_actual=base_qty,
                    conversion_factor=unit.conversion_factor, price_level=replacement.price_level.value,
                    unit_price=price.price, total_price=total, cost_at_sale=cost,
                    tax_rate=product.tax_rate,
                    bundle_components_snapshot=components if product.is_bundle else [],
                )
                db.add(exchange_item)
                exchange_items.append(exchange_item)
            exchange_order.total_amount = replacement_total
            exchange_order.tax_amount = OrderService._included_tax(exchange_items, Decimal("0"))
            result.exchange_order_id = exchange_order.id

        if returned_total != quote["returned_value"] or replacement_total != quote["replacement_value"]:
            raise ValueError("Return settlement changed. Review the amounts before confirming again.")
        difference = replacement_total - returned_total
        result.returned_value = returned_total
        result.replacement_value = replacement_total
        if difference < 0:
            result.refund_amount = -difference
        elif difference > 0:
            result.charge_amount = difference
        if order.payment_method == "Deferred Payment":
            if order.customer_id is None:
                raise ValueError("Deferred order has no customer.")
            customer = (await db.execute(select(Customer).where(Customer.id == order.customer_id).with_for_update())).scalar_one()
            next_balance = Decimal(str(customer.balance or 0)) + difference
            if next_balance < 0:
                raise ValueError("Return exceeds outstanding customer balance; manual review required.")
            if next_balance > Decimal(str(customer.credit_limit or 0)):
                raise ValueError("Exchange exceeds customer credit limit.")
            customer.balance = next_balance
        else:
            if (result.refund_amount or result.charge_amount) and not payload.settlement_confirmed:
                raise ValueError("Confirm refund or collection through the original payment method before recording the return.")
            shift_id = (await open_shift(db, user_id)).id if order.payment_method == "Cash" and (result.refund_amount or result.charge_amount) else None
            if result.refund_amount:
                db.add(Payment(order_id=order.id, customer_id=order.customer_id, user_id=user_id,
                               shift_id=shift_id, amount=result.refund_amount, method=order.payment_method, kind="REFUND"))
            if result.charge_amount:
                db.add(Payment(order_id=exchange_order.id if exchange_order else order.id,
                               customer_id=order.customer_id, user_id=user_id,
                               shift_id=shift_id, amount=result.charge_amount, method=order.payment_method, kind="SALE"))

        await db.flush()
        returned_quantities = dict((await db.execute(select(SalesReturnLine.order_item_id, func.sum(SalesReturnLine.quantity)).where(
            SalesReturnLine.order_item_id.in_([item.id for item in original_items]),
        ).group_by(SalesReturnLine.order_item_id))).all())
        if all(Decimal(str(returned_quantities.get(item.id, 0))) >= Decimal(str(item.quantity_requested)) for item in original_items):
            order.status = OrderStatusEnum.RETURNED.value
        await OrderService._record_customer_sale(db, order.customer_id, Decimal("0"))

        db.add(AuditLog(user_id=user_id, action="RETURN_OR_EXCHANGE", entity_type="Order", entity_id=str(order.id),
                        new_value={"return_id": str(result.id), "kind": payload.kind,
                                   "refund_amount": str(result.refund_amount), "charge_amount": str(result.charge_amount)}))
        await db.commit()
        await db.refresh(result)
        return result
