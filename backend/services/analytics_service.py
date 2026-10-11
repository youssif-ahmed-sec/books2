"""Period accounting from completed sales, immutable returns, and payment entries."""

from datetime import datetime, timedelta
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.customer import Customer
from models.financial import CashAdjustment, Expense, Income, Payment
from models.inventory import InventoryBalance
from models.order import Order, OrderItem, OrderStatusEnum
from models.product import Product, Supplier, SupplierPayment, Category
from models.inventory import InventoryTransaction, TransactionTypeEnum
from models.purchase import PurchaseOrder
from models.returns import SalesReturn, SalesReturnLine


COMPLETED = (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value)


def _period(query, column, start: datetime | None, end: datetime | None):
    if start is not None:
        query = query.where(column >= start)
    if end is not None:
        query = query.where(column < end)
    return query


async def financial_summary(db: AsyncSession, start: datetime | None = None, end: datetime | None = None) -> dict:
    sales = (await db.execute(_period(select(Order).where(Order.status.in_(COMPLETED)), Order.created_at, start, end))).scalars().all()
    order_ids = [order.id for order in sales]
    sale_total = sum((Decimal(str(order.total_amount)) for order in sales), Decimal("0"))
    sale_items = (await db.execute(select(OrderItem).where(OrderItem.order_id.in_(order_ids)))).scalars().all() if order_ids else []
    sale_cost_known = all(item.cost_at_sale is not None for item in sale_items)
    sale_cost = sum((Decimal(str(item.cost_at_sale or 0)) for item in sale_items), Decimal("0"))

    returns = (await db.execute(_period(select(SalesReturn), SalesReturn.created_at, start, end))).scalars().all()
    return_ids = [record.id for record in returns]
    refunded_sales = sum((Decimal(str(record.returned_value)) for record in returns), Decimal("0"))
    return_rows = (await db.execute(select(SalesReturnLine, OrderItem).join(
        OrderItem, OrderItem.id == SalesReturnLine.order_item_id,
    ).where(SalesReturnLine.return_id.in_(return_ids)))).all() if return_ids else []
    return_cost_known = all(item.cost_at_sale is not None for _, item in return_rows)
    returned_cost = sum((
        Decimal(str(item.cost_at_sale or 0)) * Decimal(str(line.quantity)) / Decimal(str(item.quantity_requested))
        for line, item in return_rows
    ), Decimal("0"))

    expenses = (await db.execute(_period(select(func.coalesce(func.sum(Expense.amount), 0)), Expense.expense_date, start, end))).scalar_one()
    other_income = (await db.execute(_period(select(func.coalesce(func.sum(Income.amount), 0)), Income.income_date, start, end))).scalar_one()
    payments = (await db.execute(_period(select(Payment), Payment.created_at, start, end))).scalars().all()
    cash_received = sum((Decimal(str(payment.amount)) for payment in payments if payment.method == "Cash" and payment.kind in ("SALE", "COLLECTION")), Decimal("0"))
    cash_refunded = sum((Decimal(str(payment.amount)) for payment in payments if payment.method == "Cash" and payment.kind == "REFUND"), Decimal("0"))
    adjustments = (await db.execute(_period(select(CashAdjustment.amount), CashAdjustment.created_at, start, end))).scalars().all()
    cash_adjustments = sum((Decimal(str(amount)) for amount in adjustments), Decimal("0"))
    customer_debt = (await db.execute(select(func.coalesce(func.sum(Customer.balance), 0)).where(Customer.is_deleted == False))).scalar_one()
    net_sales = sale_total - refunded_sales
    gross_profit = net_sales - sale_cost + returned_cost if sale_cost_known and return_cost_known else None
    net_profit = gross_profit + Decimal(str(other_income)) - Decimal(str(expenses)) if gross_profit is not None else None
    return {
        "sales": float(sale_total), "returns": float(refunded_sales), "net_sales": float(net_sales),
        "completed_orders": len(sales), "gross_profit": float(gross_profit) if gross_profit is not None else None,
        "net_profit": float(net_profit) if net_profit is not None else None,
        "expenses": float(expenses), "other_income": float(other_income),
        "cash_receipts": float(cash_received), "cash_refunds": float(cash_refunded),
        "cash_adjustments": float(cash_adjustments),
        "cash_movement": float(cash_received - cash_refunded + cash_adjustments), "customer_debt": float(customer_debt),
        "profit_incomplete": not (sale_cost_known and return_cost_known),
    }


async def stock_alerts(db: AsyncSession) -> list[dict]:
    products = (await db.execute(select(Product).where(Product.is_deleted == False, Product.is_active == True))).scalars().all()
    totals = dict((await db.execute(select(InventoryBalance.product_id, func.sum(InventoryBalance.current_stock)).group_by(
        InventoryBalance.product_id,
    ))).all())
    alerts = []
    for product in products:
        stock = Decimal(str(totals.get(product.id, 0)))
        minimum = Decimal(str(product.min_stock_level or 0))
        if stock <= 0 or (minimum > 0 and stock <= minimum):
            alerts.append({"product_id": product.id, "name": product.name_ar, "stock": float(stock),
                           "minimum": float(minimum), "severity": "out" if stock <= 0 else "low"})
    return alerts


async def management_details(db: AsyncSession, now: datetime) -> dict:
    orders = (await db.execute(select(Order).where(Order.status.in_(COMPLETED)))).scalars().all()
    order_ids = [order.id for order in orders]
    by_order = {order.id: order for order in orders}
    items = (await db.execute(select(OrderItem, Product).join(Product, Product.id == OrderItem.product_id).where(
        OrderItem.order_id.in_(order_ids),
    ))).all() if order_ids else []
    returned = dict((await db.execute(select(SalesReturnLine.order_item_id, func.sum(SalesReturnLine.amount)).group_by(
        SalesReturnLine.order_item_id,
    ))).all())
    subtotals: dict = defaultdict(Decimal)
    for item, _ in items:
        subtotals[item.order_id] += Decimal(str(item.total_price))
    product_totals: dict = defaultdict(Decimal)
    category_totals: dict = defaultdict(Decimal)
    customer_totals: dict = defaultdict(Decimal)
    sources: dict = defaultdict(Decimal)
    for item, product in items:
        order = by_order[item.order_id]
        subtotal = subtotals[order.id]
        discount_share = Decimal(str(item.total_price)) * Decimal(str(order.discount_amount or 0)) / subtotal if subtotal else Decimal("0")
        net = Decimal(str(item.total_price)) - discount_share - Decimal(str(returned.get(item.id, 0)))
        product_totals[(product.id, product.name_ar)] += net
        category_totals[product.category_id] += net
        if order.customer_id:
            customer_totals[order.customer_id] += net
        sources[order.source] += net
    category_ids = [key for key in category_totals if key is not None]
    category_names = dict((await db.execute(select(Category.id, Category.name_ar).where(Category.id.in_(category_ids)))).all()) if category_ids else {}
    customers = (await db.execute(select(Customer).where(Customer.is_deleted == False))).scalars().all()
    customer_names = {customer.id: customer.name for customer in customers}
    delayed = (await db.execute(select(Order.id, Order.assigned_to_id, Order.preparing_started_at).where(
        Order.status == OrderStatusEnum.PREPARING.value,
        Order.preparing_started_at < now - timedelta(hours=2),
    ))).all()

    supplier_rows = (await db.execute(select(Supplier).where(Supplier.is_deleted == False))).scalars().all()
    receipt_rows = (await db.execute(select(InventoryTransaction.supplier_id, InventoryTransaction.quantity_changed,
        InventoryTransaction.unit_cost, InventoryTransaction.notes).where(InventoryTransaction.transaction_type == TransactionTypeEnum.RECEIVING))).all()
    payments = (await db.execute(select(SupplierPayment.supplier_id, SupplierPayment.amount))).all()
    purchase_orders = (await db.execute(select(PurchaseOrder.supplier_id, PurchaseOrder.status))).all()
    suppliers = []
    unattributed = any(row.supplier_id is None and row.notes != "Initial stock from product creation" for row in receipt_rows)
    for supplier in supplier_rows:
        rows = [row for row in receipt_rows if row.supplier_id == supplier.id]
        incomplete = unattributed or any(row.unit_cost is None for row in rows)
        received_value = sum((Decimal(str(row.quantity_changed)) * Decimal(str(row.unit_cost or 0)) for row in rows), Decimal("0"))
        paid = sum((Decimal(str(amount)) for supplier_id, amount in payments if supplier_id == supplier.id), Decimal("0"))
        statuses = [status for supplier_id, status in purchase_orders if supplier_id == supplier.id]
        suppliers.append({"id": supplier.id, "name": supplier.name,
                          "balance": None if incomplete else float(Decimal(str(supplier.opening_balance or 0)) + received_value - paid),
                          "statement_incomplete": incomplete, "orders": len(statuses),
                          "received_orders": statuses.count("RECEIVED")})

    def top(values, name):
        return [{"id": str(key), "name": name(key), "net_sales": float(value)}
                for key, value in sorted(values.items(), key=lambda row: row[1], reverse=True)[:5]]

    return {
        "top_products": top(product_totals, lambda key: key[1]),
        "top_categories": top(category_totals, lambda key: category_names.get(key, "غير مصنف")),
        "top_customers": top(customer_totals, lambda key: customer_names.get(key, "عميل غير متاح")),
        "sales_by_source": {source: float(total) for source, total in sources.items()},
        "new_customers": sum(1 for customer in customers if customer.created_at and customer.created_at.date() == now.date()),
        "returning_customers": sum(1 for customer in customers if (customer.purchase_count or 0) > 1),
        "delayed_orders": [{"id": str(order_id), "assigned_to_id": str(assignee) if assignee else None,
                            "hours": round((now - started).total_seconds() / 3600, 1)} for order_id, assignee, started in delayed],
        "suppliers": suppliers,
    }
