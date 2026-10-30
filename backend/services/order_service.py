from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID
from types import SimpleNamespace

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_, func, exists, or_, select as sa_select
from sqlalchemy.orm import aliased

from core.idempotency import IdempotencyConflict, request_fingerprint
from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum, Warehouse
from models.order import Order, OrderItem, OrderStatusEnum, OrderSourceEnum
from models.product import Product, ProductPrice, ProductUnit, ProductBundleComponent
from models.customer import Customer
from models.user import User, RoleEnum
from models.user import AuditLog
from models.financial import Payment
from models.returns import SalesReturn
from models.sale_correction import SaleCorrection
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate, OrderPreparation, LeadCreate
from services.inventory_service import InventoryService
from services.notification_service import notify_low_stock_crossing
from services.order_workflow import allowed_next_statuses
from services.cash_register_service import open_shift
from services.sale_correction_pricing import _component_signature


class OrderService:
    @staticmethod
    async def create_lead(db: AsyncSession, payload: LeadCreate, user_id: UUID) -> dict:
        if payload.source not in (OrderSourceEnum.PHONE_CALL, OrderSourceEnum.WALK_IN, OrderSourceEnum.MANUAL):
            raise ValueError("Manual lead source must be phone, walk-in, or manual entry.")
        if payload.customer_id is not None:
            customer = (await db.execute(select(Customer.id).where(Customer.id == payload.customer_id, Customer.is_deleted == False))).scalar_one_or_none()
            if customer is None:
                raise ValueError("Customer not found.")
        lead = Order(customer_id=payload.customer_id, user_id=user_id, assigned_to_id=user_id,
                     status=OrderStatusEnum.NEW_LEAD.value, source=payload.source.value,
                     notes=payload.notes, priority=payload.priority, total_amount=0, tax_amount=0, discount_amount=0, shipping_cost=0)
        db.add(lead)
        await db.flush()
        db.add(AuditLog(user_id=user_id, action="CREATE_MANUAL_LEAD", entity_type="Order", entity_id=str(lead.id)))
        await db.commit()
        await db.refresh(lead)
        return OrderService._build_order_dict(lead, [])

    @staticmethod
    def _included_tax(items: list[OrderItem], discount: Decimal) -> Decimal:
        subtotal = sum((Decimal(str(item.total_price)) for item in items), Decimal("0"))
        if subtotal <= 0:
            return Decimal("0")
        tax = Decimal("0")
        for item in items:
            rate = Decimal(str(item.tax_rate or 0))
            if rate > 0:
                discounted_line = Decimal(str(item.total_price)) * (subtotal - min(discount, subtotal)) / subtotal
                tax += discounted_line * rate / (Decimal("100") + rate)
        return tax.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @staticmethod
    async def _item_cost(db: AsyncSession, product: Product, quantity: Decimal, components=None) -> Decimal:
        if not product.is_bundle:
            return Decimal(str(product.cost or 0)) * quantity
        total = Decimal("0")
        for component in components or []:
            component_product = (await db.execute(select(Product).where(Product.id == component.component_id))).scalar_one_or_none()
            if component_product is None or component_product.is_deleted:
                raise ValueError("Bundle component is unavailable.")
            total += Decimal(str(component_product.cost or 0)) * Decimal(str(component.quantity)) * quantity
        return total

    @staticmethod
    async def _check_pricing_policy(db: AsyncSession, customer_id: Optional[UUID], items, discount: Decimal, user_id: UUID) -> None:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if user is None or user.is_deleted or not user.is_active:
            raise PermissionError("Active staff account required.")
        if discount > 0 and user.role != RoleEnum.ADMIN:
            raise PermissionError("Admin approval is required for a discount.")

        expected_level = "Retail"
        if customer_id is not None:
            customer = (await db.execute(select(Customer).where(
                Customer.id == customer_id,
                Customer.is_deleted == False,
                Customer.is_active == True,
            ))).scalar_one_or_none()
            if customer is None:
                raise ValueError("Active customer not found.")
            expected_level = customer.price_level.value

        if user.role != RoleEnum.ADMIN and any(item.price_level.value != expected_level for item in items):
            raise PermissionError("Admin approval is required to change the customer's price level.")

    @staticmethod
    async def _record_customer_sale(db: AsyncSession, customer_id: Optional[UUID], total: Decimal) -> None:
        if customer_id is None:
            return
        customer = (await db.execute(select(Customer).where(Customer.id == customer_id).with_for_update())).scalar_one_or_none()
        if customer is None or customer.is_deleted:
            raise ValueError("Customer not found.")
        await db.flush()
        completed = (
            OrderStatusEnum.DELIVERED.value,
            OrderStatusEnum.CLOSED.value,
            OrderStatusEnum.RETURNED.value,
            OrderStatusEnum.EXCHANGE.value,
        )
        original_order = aliased(Order)
        corrected_order = aliased(Order)
        moved_out = exists(sa_select(1).select_from(SaleCorrection).join(
            corrected_order, corrected_order.id == SaleCorrection.corrected_order_id,
        ).where(SaleCorrection.order_id == Order.id, SaleCorrection.status == "APPLIED",
                corrected_order.customer_id.is_distinct_from(Order.customer_id)).correlate(Order))
        moved_in = exists(sa_select(1).select_from(SaleCorrection).join(
            original_order, original_order.id == SaleCorrection.order_id,
        ).where(SaleCorrection.corrected_order_id == Order.id, SaleCorrection.status == "APPLIED",
                original_order.customer_id.is_distinct_from(Order.customer_id)).correlate(Order))
        counts_as_purchase = and_(or_(~exists().where(SalesReturn.exchange_order_id == Order.id), moved_in), ~moved_out)
        sale_total, purchase_count, last_purchase = (await db.execute(
            select(
                func.coalesce(func.sum(Order.total_amount), 0),
                func.count(Order.id).filter(counts_as_purchase),
                func.max(Order.created_at).filter(counts_as_purchase),
            ).where(Order.customer_id == customer_id, Order.status.in_(completed))
        )).one()
        returned_total = (await db.execute(
            select(func.coalesce(func.sum(SalesReturn.returned_value), 0))
            .join(Order, Order.id == SalesReturn.order_id)
            .where(Order.customer_id == customer_id)
        )).scalar_one()
        net = Decimal(str(sale_total)) - Decimal(str(returned_total))
        customer.purchase_count = purchase_count
        customer.total_purchases = net
        customer.average_purchase = net / purchase_count if purchase_count else Decimal("0")
        customer.last_purchase_date = last_purchase

    @staticmethod
    async def _settle_sale(
        db: AsyncSession, order: Order, user_id: UUID,
        amount_received: Decimal | None = None, received_method: str | None = None,
    ) -> None:
        amount = Decimal(str(order.total_amount))
        if order.payment_method == "Deferred Payment":
            if order.customer_id is None:
                raise ValueError("Deferred payment requires a registered customer.")
            customer = (await db.execute(select(Customer).where(
                Customer.id == order.customer_id,
                Customer.is_deleted == False,
                Customer.is_active == True,
            ).with_for_update())).scalar_one_or_none()
            if customer is None:
                raise ValueError("Active customer not found.")
            collected = amount_received if amount_received is not None else Decimal("0")
            if collected < 0 or collected > amount:
                raise ValueError("Received amount must be between zero and the sale total.")
            next_balance = Decimal(str(customer.balance or 0)) + amount - collected
            if next_balance > Decimal(str(customer.credit_limit or 0)):
                raise ValueError("Customer credit limit would be exceeded.")
            customer.balance = next_balance
            order.deferred_remaining = amount - collected
            if collected > 0:
                if received_method is None:
                    raise ValueError("Choose how the received amount was paid.")
                shift_id = (await open_shift(db, user_id)).id if received_method == "Cash" else None
                db.add(Payment(
                    order_id=order.id, customer_id=order.customer_id, user_id=user_id,
                    shift_id=shift_id, amount=collected, method=received_method, kind="SALE",
                ))
        elif amount > 0:
            shift_id = (await open_shift(db, user_id)).id if order.payment_method == "Cash" else None
            db.add(Payment(
                order_id=order.id, customer_id=order.customer_id, user_id=user_id,
                shift_id=shift_id, amount=amount, method=order.payment_method, kind="SALE",
            ))

    @staticmethod
    def _build_order_dict(order, items):
        return {
            "id":              order.id,
            "public_number":   order.public_number,
            "customer_id":     order.customer_id,
            "customer_address": order.customer_address,
            "user_id":         order.user_id,
            "assigned_to_id":  order.assigned_to_id,
            "status":          order.status.value if hasattr(order.status, "value") else order.status,
            "allowed_next_statuses": allowed_next_statuses(order.status.value if hasattr(order.status, "value") else order.status),
            "source":          (order.source.value if hasattr(order.source, "value") else order.source) if order.source else "Walk-In Customer",
            "priority":        order.priority or "Normal",
            "total_amount":    float(order.total_amount),
            "tax_amount":      float(order.tax_amount),
            "discount_amount": float(order.discount_amount),
            "discount_percent": float(order.discount_percent) if order.discount_percent is not None else None,
            "wallet_fee_amount": float(order.wallet_fee_amount or 0),
            "shipping_cost":   float(order.shipping_cost),
            "expected_collection_method": order.expected_collection_method,
            "next_due_date": order.next_due_date,
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
                    "tax_rate":          float(item.tax_rate) if item.tax_rate is not None else None,
                    "created_at":         item.created_at,
                }
                for item in items
            ],
        }

    @staticmethod
    async def create_order(db: AsyncSession, order_in: OrderCreate, current_user_id: UUID) -> dict:
        fingerprint = request_fingerprint(order_in)
        existing = (await db.execute(select(Order).where(Order.request_id == order_in.request_id))).scalar_one_or_none()
        if existing is not None:
            return await OrderService._replay_order(db, existing, fingerprint, current_user_id)
        try:
            return await OrderService._create_order_once(db, order_in, current_user_id, fingerprint)
        except IntegrityError:
            await db.rollback()
            existing = (await db.execute(select(Order).where(Order.request_id == order_in.request_id))).scalar_one_or_none()
            if existing is None:
                raise
            return await OrderService._replay_order(db, existing, fingerprint, current_user_id)

    @staticmethod
    async def _replay_order(db: AsyncSession, order: Order, fingerprint: str, current_user_id: UUID) -> dict:
        if order.user_id != current_user_id or order.request_fingerprint != fingerprint:
            raise IdempotencyConflict("Request ID was already used for a different checkout.")
        items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
        return OrderService._build_order_dict(order, items)

    @staticmethod
    async def _create_order_once(db: AsyncSession, order_in: OrderCreate, current_user_id: UUID, fingerprint: str,
                                 *, commit: bool = True, correction_lines=None, original_order_id: UUID | None = None,
                                 pricing_user_id: UUID | None = None, defer_payment: bool = False) -> dict:
        if correction_lines is not None:
            if commit or not defer_payment or original_order_id is None or pricing_user_id is None or len(correction_lines) != len(order_in.items):
                raise ValueError("Correction checkout must use a caller-owned transaction and deferred settlement.")
            if order_in.payment_method not in ("Cash", "Credit Card", "Instapay", "Wallet", "Deferred Payment"):
                raise ValueError("This correction payment method needs manual review.")
        elif defer_payment or original_order_id is not None or pricing_user_id is not None:
            raise ValueError("Correction checkout requires trusted correction lines.")
        await OrderService._check_pricing_policy(db, order_in.customer_id, order_in.items, order_in.discount_amount,
                                                 pricing_user_id or current_user_id)
        selected_address = order_in.customer_address.strip() if order_in.customer_address is not None else None
        if selected_address:
            if order_in.customer_id is None:
                raise ValueError("A sale address requires a registered customer.")
            customer = (await db.execute(select(Customer).where(Customer.id == order_in.customer_id, Customer.is_deleted == False))).scalar_one_or_none()
            if customer is None or selected_address not in [customer.address, *(customer.addresses or [])]:
                raise ValueError("Choose a saved address for this customer.")
        warehouse = (await db.execute(select(Warehouse).where(Warehouse.id == order_in.warehouse_id, Warehouse.is_active == True).with_for_update())).scalar_one_or_none()
        if warehouse is None:
            raise ValueError("Choose an active warehouse for the sale.")
        order = Order(
            customer_id=order_in.customer_id,
            customer_address=selected_address,
            user_id=current_user_id,
            status=order_in.status.value,
            source=order_in.source if hasattr(order_in, "source") and order_in.source else OrderSourceEnum.WALK_IN.value,
            discount_amount=Decimal(str(order_in.discount_amount)),
            discount_percent=order_in.discount_percent,
            wallet_fee_amount=Decimal("0"),
            shipping_cost=order_in.shipping_cost,
            expected_collection_method=order_in.expected_collection_method,
            payment_method=order_in.payment_method,
            notes=order_in.notes,
            request_id=order_in.request_id,
            request_fingerprint=fingerprint,
            total_amount=Decimal("0"),
            tax_amount=Decimal("0"),
        )
        db.add(order)
        await db.flush()

        grand_total = Decimal("0")
        items_out = []

        for index, item_in in enumerate(order_in.items):
            correction_line = correction_lines[index] if correction_lines is not None else None
            unit_query = select(ProductUnit).where(
                    ProductUnit.id == item_in.unit_id,
                    ProductUnit.product_id == item_in.product_id,
                    ProductUnit.is_deleted == False,
                )
            if correction_line is not None:
                unit_query = unit_query.with_for_update().execution_options(populate_existing=True)
            unit_q = await db.execute(unit_query)
            unit = unit_q.scalar_one_or_none()
            if unit is None:
                await db.rollback()
                raise ValueError("Unit not found.")

            conversion_factor = Decimal(str(unit.conversion_factor))
            qty_requested     = Decimal(str(item_in.quantity))
            qty_actual        = qty_requested * conversion_factor

            price_query = select(ProductPrice).where(
                    ProductPrice.product_id == item_in.product_id,
                    ProductPrice.unit_id == item_in.unit_id,
                    ProductPrice.price_level == item_in.price_level.value,
                    ProductPrice.is_deleted == False,
                )
            if correction_line is not None:
                price_query = price_query.with_for_update().execution_options(populate_existing=True)
            price_q = await db.execute(price_query)
            price_record = price_q.scalar_one_or_none()
            if not price_record and (correction_line is None or correction_line.original_item_id is None):
                await db.rollback()
                raise ValueError("Price missing.")

            original_item = None
            if correction_line is not None:
                if (correction_line.product_id != item_in.product_id or correction_line.unit_id != item_in.unit_id
                        or correction_line.price_level != item_in.price_level.value
                        or correction_line.quantity != qty_requested or correction_line.conversion_factor != conversion_factor):
                    raise ValueError("The corrected line or unit changed; review it again.")
                if correction_line.original_item_id is not None:
                    original_item = (await db.execute(select(OrderItem).where(
                        OrderItem.id == correction_line.original_item_id, OrderItem.order_id == original_order_id,
                    ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
                    if (original_item is None or original_item.product_id != item_in.product_id
                            or original_item.unit_id != item_in.unit_id or original_item.price_level != item_in.price_level.value
                            or Decimal(str(original_item.unit_price)) != correction_line.unit_price
                            or Decimal(str(original_item.conversion_factor)) != correction_line.conversion_factor
                            or original_item.bundle_components_snapshot != correction_line.bundle_components_snapshot
                            or original_item.bundle_components_snapshot is None or original_item.cost_at_sale is None):
                        raise ValueError("The original line needs manual review.")
                elif Decimal(str(price_record.price)) != correction_line.unit_price:
                    raise ValueError("The corrected line price changed; review it again.")
                unit_price = correction_line.unit_price
            else:
                unit_price = Decimal(str(price_record.price))
            if unit_price <= 0:
                raise ValueError("Sale price must be greater than zero.")
            item_total = unit_price * qty_requested

            product_query = select(Product).where(Product.id == item_in.product_id)
            if correction_line is not None:
                product_query = product_query.with_for_update().execution_options(populate_existing=True)
            prod_q = await db.execute(product_query)
            product = prod_q.scalar_one_or_none()
            if product is None or product.is_deleted or not product.is_active:
                await db.rollback()
                raise ValueError("Product is not available for sale.")
            if correction_line is not None and original_item is None:
                if ((not product.is_bundle and Decimal(str(product.cost)) != correction_line.base_cost)
                        or (Decimal(str(product.tax_rate)) if product.tax_rate is not None else None) != correction_line.tax_rate):
                    raise ValueError("The corrected item cost or tax changed; review it again.")
            
            components_to_deduct = []
            bundle_comps = []
            if correction_line is not None and bool(product.is_bundle) != bool(correction_line.bundle_components_snapshot):
                raise ValueError("The corrected bundle type changed; review it again.")
            if product.is_bundle:
                if original_item is not None and correction_line is not None:
                    bundle_comps = [SimpleNamespace(component_id=UUID(part["product_id"]), quantity=Decimal(str(part["quantity"])))
                                    for part in correction_line.bundle_components_snapshot]
                else:
                    bundle_query = select(ProductBundleComponent).where(ProductBundleComponent.bundle_id == product.id, ProductBundleComponent.is_deleted == False)
                    if correction_line is not None:
                        bundle_query = bundle_query.with_for_update().execution_options(populate_existing=True)
                    bundle_comps = (await db.execute(bundle_query)).scalars().all()
                if not bundle_comps:
                    await db.rollback()
                    raise ValueError("Bundle has no components.")
                if correction_line is not None and original_item is None:
                    current_recipe = [{"product_id": str(part.component_id), "quantity": str(part.quantity)} for part in bundle_comps]
                    if _component_signature(current_recipe) != _component_signature(correction_line.bundle_components_snapshot):
                        raise ValueError("The bundle components changed; review it again.")
                    current_cost = await OrderService._item_cost(db, product, Decimal("1"), bundle_comps)
                    if current_cost != correction_line.base_cost:
                        raise ValueError("The corrected item cost or tax changed; review it again.")
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
                
                balance_q = await db.execute(
                    select(InventoryBalance).where(
                        InventoryBalance.product_id == c_prod_id,
                        InventoryBalance.warehouse_id == order_in.warehouse_id,
                    ).with_for_update()
                )

                balance = balance_q.scalar_one_or_none()
                if not balance or Decimal(str(balance.current_stock)) < c_qty:
                    await db.rollback()
                    raise ValueError(f"Insufficient stock for product/component {c_prod_id}.")

                stock_before = Decimal(str(balance.current_stock))
                InventoryService.record_movement(
                    db, balance, -c_qty, current_user_id, TransactionTypeEnum.ISSUING,
                    reference_document=str(order.id),
                    notes=f"POS Order #{order.id}",
                )
                component_product = product if not product.is_bundle else (await db.execute(
                    select(Product).where(Product.id == c_prod_id)
                )).scalar_one()
                await notify_low_stock_crossing(db, component_product, stock_before, balance.current_stock)

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
                bundle_components_snapshot=[
                    {"product_id": str(component.component_id), "quantity": str(component.quantity)}
                    for component in bundle_comps
                ],
                cost_at_sale=(Decimal(str(original_item.cost_at_sale)) * qty_requested / Decimal(str(original_item.quantity_requested))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                             if original_item is not None else await OrderService._item_cost(db, product, qty_actual, bundle_comps),
                tax_rate=original_item.tax_rate if original_item is not None else product.tax_rate,
            )
            db.add(order_item)
            await db.flush()

            grand_total += item_total
            items_out.append(order_item)

        discount_amount = Decimal(str(order_in.discount_amount))
        if discount_amount > grand_total:
            await db.rollback()
            raise ValueError("Discount cannot exceed the order subtotal.")
        if order_in.discount_percent is not None:
            percentage_discount = (grand_total * order_in.discount_percent / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if discount_amount != percentage_discount:
                await db.rollback()
                raise ValueError("Discount percentage does not match the order subtotal.")
        base_total = grand_total - discount_amount + order_in.shipping_cost
        wallet_base = Decimal("0")
        if order_in.payment_method == "Wallet":
            wallet_base = base_total
        elif order_in.payment_method == "Deferred Payment" and order_in.received_method == "Wallet":
            wallet_base = order_in.amount_received or Decimal("0")
        wallet_fee = (wallet_base / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        order.wallet_fee_amount = wallet_fee
        order.total_amount = base_total + wallet_fee
        if order_in.payment_method == "Deferred Payment":
            remaining = order.total_amount - (order_in.amount_received or Decimal("0")) - (
                wallet_fee if order_in.received_method == "Wallet" else Decimal("0")
            )
            if remaining > 0 and order_in.expected_collection_method is None:
                raise ValueError("Choose the expected collection method for the remaining balance.")
            if remaining <= 0 and order_in.expected_collection_method is not None:
                raise ValueError("No remaining balance needs a collection method.")
            if remaining > 0 and order_in.next_due_date is None:
                raise ValueError("حدد تاريخ استحقاق الدفعة القادمة.")
            if remaining <= 0 and order_in.next_due_date is not None:
                raise ValueError("لا يوجد مبلغ آجل يحتاج تاريخ استحقاق.")
            if order_in.next_due_date is not None:
                from datetime import datetime
                from zoneinfo import ZoneInfo
                if order_in.next_due_date < datetime.now(ZoneInfo("Africa/Cairo")).date():
                    raise ValueError("تاريخ الاستحقاق لا يمكن أن يكون في الماضي.")
            order.next_due_date = order_in.next_due_date
            if defer_payment:
                order.deferred_remaining = remaining
        if order_in.expected_total is not None and order.total_amount != order_in.expected_total:
            await db.rollback()
            raise ValueError("Prices changed. Refresh the cart before checkout.")
        order.tax_amount = OrderService._included_tax(items_out, discount_amount)
        collected_base = order_in.amount_received
        if order_in.payment_method == "Deferred Payment" and order_in.received_method == "Wallet" and collected_base is not None:
            collected_base += wallet_fee
        if not defer_payment:
            await OrderService._settle_sale(db, order, current_user_id, collected_base, order_in.received_method)
        await OrderService._record_customer_sale(db, order.customer_id, order.total_amount)
        db.add(AuditLog(user_id=current_user_id, action="CREATE_POS_INVOICE", entity_type="Order", entity_id=str(order.id), new_value={"total": str(order.total_amount), "payment_method": order.payment_method}))
        if commit:
            await db.commit()
        else:
            await db.flush()
        await db.refresh(order)
        return OrderService._build_order_dict(order, items_out)

    @staticmethod
    async def create_draft_order(db: AsyncSession, order_in: OrderDraftCreate, current_user_id: UUID) -> dict:
        await OrderService._check_pricing_policy(db, order_in.customer_id, order_in.items, order_in.discount_amount, current_user_id)
        if order_in.lead_id is not None:
            order = (await db.execute(select(Order).where(Order.id == order_in.lead_id).with_for_update())).scalar_one_or_none()
            if order is None or order.status != OrderStatusEnum.NEW_LEAD.value:
                raise ValueError("Lead is not available for conversion.")
            if order.user_id != current_user_id:
                user = (await db.execute(select(User).where(User.id == current_user_id))).scalar_one()
                if user.role != RoleEnum.ADMIN:
                    raise PermissionError("Only the lead owner or admin may convert it.")
            order.customer_id = order_in.customer_id
            order.assigned_to_id = order_in.assigned_to_id or order.assigned_to_id
            order.status = OrderStatusEnum.DRAFT.value
            order.source = order_in.source.value
            order.discount_amount = Decimal(str(order_in.discount_amount))
            order.shipping_cost = Decimal(str(order_in.shipping_cost))
            order.payment_method = order_in.payment_method
            order.notes = order_in.notes or order.notes
            order.total_amount = Decimal("0")
            order.tax_amount = Decimal("0")
        else:
            order = Order(
                customer_id=order_in.customer_id, user_id=current_user_id,
                assigned_to_id=order_in.assigned_to_id, status=order_in.status.value,
                source=order_in.source.value, discount_amount=Decimal(str(order_in.discount_amount)),
                shipping_cost=Decimal(str(order_in.shipping_cost)), payment_method=order_in.payment_method,
                notes=order_in.notes, total_amount=Decimal("0"), tax_amount=Decimal("0"),
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
                    ProductPrice.is_deleted == False,
                )
            )
            price_record = price_q.scalar_one_or_none()
            if not price_record:
                await db.rollback()
                raise ValueError(f"Price missing for {item_in.price_level.value}.")

            unit_price = Decimal(str(price_record.price))
            if unit_price <= 0:
                raise ValueError("Sale price must be greater than zero.")
            item_total = unit_price * qty_requested

            product_q = await db.execute(select(Product).where(Product.id == item_in.product_id))
            product = product_q.scalar_one_or_none()
            bundle_snapshot = []
            if product.is_bundle:
                components_q = await db.execute(
                    select(ProductBundleComponent).where(ProductBundleComponent.bundle_id == product.id, ProductBundleComponent.is_deleted == False)
                )
                components = components_q.scalars().all()
                if not components:
                    await db.rollback()
                    raise ValueError("Bundle has no components.")
                bundle_snapshot = [
                    {"product_id": str(component.component_id), "quantity": str(component.quantity)}
                    for component in components
                ]

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
                cost_at_sale=await OrderService._item_cost(db, product, qty_actual, components if product.is_bundle else None),
                tax_rate=product.tax_rate,
                bundle_components_snapshot=bundle_snapshot,
            )
            db.add(order_item)
            await db.flush()

            grand_total += item_total
            items_out.append(order_item)

        if Decimal(str(order_in.discount_amount)) > grand_total + Decimal(str(order_in.shipping_cost)):
            await db.rollback()
            raise ValueError("Discount cannot exceed the order total.")
        order.total_amount = grand_total + Decimal(str(order_in.shipping_cost)) - Decimal(str(order_in.discount_amount))
        order.tax_amount = OrderService._included_tax(items_out, Decimal(str(order_in.discount_amount)))
        db.add(AuditLog(user_id=current_user_id, action="CREATE_OR_CONVERT_DRAFT", entity_type="Order", entity_id=str(order.id), new_value={"total": str(order.total_amount)}))
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
        if new_status != old_status and new_status not in allowed_next_statuses(old_status):
            raise ValueError(f"Transition from {old_status} to {new_status} is not allowed.")
        if old_status == OrderStatusEnum.NEW_LEAD.value and new_status == OrderStatusEnum.DRAFT.value:
            raise ValueError("Convert the lead with products to a draft order.")
        if new_status in (OrderStatusEnum.PREPARING.value, OrderStatusEnum.READY.value) and new_status != old_status:
            raise ValueError("Use assignment and preparation workflow for these statuses.")

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
        if old_status not in fulfilled and new_status in fulfilled:
            await OrderService._settle_sale(db, order, current_user_id)
            await OrderService._record_customer_sale(db, order.customer_id, Decimal(str(order.total_amount)))
        if new_status != old_status:
            db.add(AuditLog(user_id=current_user_id, action="UPDATE_ORDER_STATUS", entity_type="Order", entity_id=str(order.id), old_value={"status": old_status}, new_value={"status": new_status}))
        await db.commit()
        await db.refresh(order)

        items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        items_out = items_q.scalars().all()
        return OrderService._build_order_dict(order, items_out)

    @staticmethod
    async def assign_preparer(db: AsyncSession, order_id: UUID, assignee_id: UUID, user_id: UUID) -> dict | None:
        order = (await db.execute(select(Order).where(Order.id == order_id).with_for_update())).scalar_one_or_none()
        if order is None:
            return None
        if order.status != OrderStatusEnum.APPROVED.value:
            raise ValueError("Only approved orders can be assigned for preparation.")
        assignee = (await db.execute(select(User).where(User.id == assignee_id, User.is_active == True, User.is_deleted == False))).scalar_one_or_none()
        if assignee is None or assignee.role != RoleEnum.CASHIER_ORDERS:
            raise ValueError("Assignee must be an active cashier.")
        order.assigned_to_id = assignee_id
        order.status = OrderStatusEnum.PREPARING.value
        order.preparing_started_at = datetime.now(timezone.utc)
        db.add(AuditLog(user_id=user_id, action="ASSIGN_ORDER_PREPARATION", entity_type="Order", entity_id=str(order_id), new_value={"assignee_id": str(assignee_id)}))
        await db.commit()
        return await OrderService.get_order(db, order_id)

    @staticmethod
    async def complete_preparation(db: AsyncSession, order_id: UUID, payload: OrderPreparation, user: User) -> dict | None:
        order = (await db.execute(select(Order).where(Order.id == order_id).with_for_update())).scalar_one_or_none()
        if order is None:
            return None
        if order.status != OrderStatusEnum.PREPARING.value:
            raise ValueError("Order is not being prepared.")
        if order.assigned_to_id != user.id and user.role != RoleEnum.ADMIN:
            raise PermissionError("Only the assigned preparer can complete this order.")
        if not payload.package_confirmed:
            raise ValueError("Packaging confirmation is required.")
        items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order_id))).scalars().all()
        picked = {line.order_item_id: line.picked_quantity for line in payload.items}
        if len(picked) != len(payload.items) or set(picked) != {item.id for item in items}:
            raise ValueError("All order items must be checked exactly once.")
        if any(picked[item.id] != Decimal(str(item.quantity_requested)) for item in items):
            raise ValueError("Picked quantities must match the approved order.")
        order.status = OrderStatusEnum.READY.value
        db.add(AuditLog(user_id=user.id, action="COMPLETE_ORDER_PREPARATION", entity_type="Order", entity_id=str(order_id), new_value={"items": [{"id": str(item.id), "quantity": str(picked[item.id])} for item in items], "package_confirmed": True}))
        await db.commit()
        return await OrderService.get_order(db, order_id)

    @staticmethod
    async def _deduct_order_stock(db: AsyncSession, order: Order, warehouse_id: UUID, current_user_id: UUID) -> None:

        items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        items = items_q.scalars().all()
        if not items:
            await db.rollback()
            raise ValueError("Cannot deliver an order without items.")

        for item in items:
            prod_q = await db.execute(select(Product).where(Product.id == item.product_id))
            product = prod_q.scalar_one_or_none()
            if product is None or product.is_deleted:
                await db.rollback()
                raise ValueError("Order product is no longer available for delivery.")

            components_to_deduct = []
            if item.bundle_components_snapshot is None:
                await db.rollback()
                raise ValueError("Legacy order needs component review before delivery.")
            if item.bundle_components_snapshot:
                for comp in item.bundle_components_snapshot:
                    components_to_deduct.append({
                        "product_id": UUID(comp["product_id"]),
                        "qty": Decimal(str(item.quantity_actual)) * Decimal(comp["quantity"])
                    })
            else:
                components_to_deduct.append({
                    "product_id": item.product_id,
                    "qty": Decimal(str(item.quantity_actual))
                })

            item_cost = Decimal("0")
            component_products = {}
            for component in components_to_deduct:
                component_product = (await db.execute(select(Product).where(Product.id == component["product_id"]))).scalar_one_or_none()
                if component_product is None or component_product.is_deleted:
                    raise ValueError("Order component is no longer available for delivery.")
                component_products[component["product_id"]] = component_product
                item_cost += Decimal(str(component_product.cost or 0)) * component["qty"]
            item.cost_at_sale = item_cost

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

                stock_before = Decimal(str(balance.current_stock))
                InventoryService.record_movement(
                    db, balance, -c_qty, current_user_id, TransactionTypeEnum.ISSUING,
                    reference_document=str(order.id),
                    notes=f"Order {order.id} Delivered",
                )
                await notify_low_stock_crossing(db, component_products[c_prod_id], stock_before, balance.current_stock)


    @staticmethod
    async def get_orders(db: AsyncSession, status: Optional[str] = None, source: Optional[str] = None, customer_id: Optional[UUID] = None, allowed_statuses: Optional[tuple[str, ...]] = None, assigned_to_id: Optional[UUID] = None, limit: int = 100, offset: int = 0) -> List[dict]:
        query = select(Order).order_by(Order.created_at.desc(), Order.id.desc())
        if allowed_statuses is not None:
            query = query.where(Order.status.in_(allowed_statuses))
        if status:
            query = query.where(Order.status == status)
        if source:
            query = query.where(Order.source == source)
        if customer_id:
            query = query.where(Order.customer_id == customer_id)
        if assigned_to_id:
            query = query.where(Order.assigned_to_id == assigned_to_id)

        orders_q = await db.execute(query.limit(limit).offset(offset))
        orders = orders_q.scalars().all()
        if not orders:
            return []
        items_q = await db.execute(select(OrderItem).where(OrderItem.order_id.in_([order.id for order in orders])))
        items_by_order = {order.id: [] for order in orders}
        for item in items_q.scalars().all():
            items_by_order[item.order_id].append(item)
        return [OrderService._build_order_dict(order, items_by_order[order.id]) for order in orders]

    @staticmethod
    async def get_order(db: AsyncSession, order_id: UUID) -> Optional[dict]:
        order_q = await db.execute(select(Order).where(Order.id == order_id))
        order = order_q.scalar_one_or_none()
        if not order:
            return None

        items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        items = items_q.scalars().all()
        
        return OrderService._build_order_dict(order, items)
