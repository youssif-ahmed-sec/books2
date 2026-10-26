"""Period accounting from completed sales, immutable returns, and payment entries."""

from datetime import date, datetime, time, timedelta
from collections import defaultdict
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from models.customer import Customer
from models.financial import CashAdjustment, Expense, Income, Payment
from models.inventory import InventoryBalance
from models.order import Order, OrderItem, OrderStatusEnum
from models.product import Product, Supplier, SupplierPayment, SupplierDebtEntry, Category
from models.inventory import InventoryTransaction, TransactionTypeEnum
from models.purchase import PurchaseOrder
from models.returns import SalesReturn, SalesReturnLine


COMPLETED = (
    OrderStatusEnum.DELIVERED.value,
    OrderStatusEnum.CLOSED.value,
    OrderStatusEnum.RETURNED.value,
    OrderStatusEnum.EXCHANGE.value,
)


def _period(query, column, start: datetime | None, end: datetime | None):
    if start is not None:
        query = query.where(column >= start)
    if end is not None:
        query = query.where(column < end)
    return query


async def financial_summary(db: AsyncSession, start: datetime | None = None, end: datetime | None = None) -> dict:
    sale_total, completed_orders = (await db.execute(_period(
        select(func.coalesce(func.sum(Order.total_amount), 0), func.count(Order.id))
        .where(Order.status.in_(COMPLETED)), Order.created_at, start, end,
    ))).one()
    sale_cost, missing_sale_cost = (await db.execute(_period(
        select(
            func.coalesce(func.sum(OrderItem.cost_at_sale), 0),
            func.coalesce(func.sum(case((OrderItem.cost_at_sale.is_(None), 1), else_=0)), 0),
        ).select_from(OrderItem).join(Order, Order.id == OrderItem.order_id)
        .where(Order.status.in_(COMPLETED)), Order.created_at, start, end,
    ))).one()

    refunded_sales = (await db.execute(_period(
        select(func.coalesce(func.sum(SalesReturn.returned_value), 0)),
        SalesReturn.created_at, start, end,
    ))).scalar_one()
    returned_cost, missing_return_cost = (await db.execute(_period(
        select(
            func.coalesce(func.sum(
                OrderItem.cost_at_sale * SalesReturnLine.quantity / OrderItem.quantity_requested,
            ), 0),
            func.coalesce(func.sum(case((OrderItem.cost_at_sale.is_(None), 1), else_=0)), 0),
        ).select_from(SalesReturnLine)
        .join(OrderItem, OrderItem.id == SalesReturnLine.order_item_id)
        .join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id),
        SalesReturn.created_at, start, end,
    ))).one()

    expenses = (await db.execute(_period(select(func.coalesce(func.sum(Expense.amount), 0)), Expense.expense_date, start, end))).scalar_one()
    other_income = (await db.execute(_period(select(func.coalesce(func.sum(Income.amount), 0)), Income.income_date, start, end))).scalar_one()
    collected_wallet_fees = (await db.execute(_period(
        select(func.coalesce(func.sum(Payment.wallet_fee_amount), 0)).where(Payment.kind == "COLLECTION"),
        Payment.created_at, start, end,
    ))).scalar_one()
    other_income = Decimal(str(other_income)) + Decimal(str(collected_wallet_fees))
    cash_received, cash_refunded = (await db.execute(_period(select(
        func.coalesce(func.sum(case((
            (Payment.method == "Cash") & Payment.kind.in_(("SALE", "COLLECTION")), Payment.amount,
        ), else_=0)), 0),
        func.coalesce(func.sum(case((
            (Payment.method == "Cash") & (Payment.kind == "REFUND"), Payment.amount,
        ), else_=0)), 0),
    ), Payment.created_at, start, end))).one()
    cash_adjustments = (await db.execute(_period(
        select(func.coalesce(func.sum(CashAdjustment.amount), 0)),
        CashAdjustment.created_at, start, end,
    ))).scalar_one()
    customer_debt = (await db.execute(select(func.coalesce(func.sum(Customer.balance), 0)).where(Customer.is_deleted == False))).scalar_one()
    sale_total = Decimal(str(sale_total))
    refunded_sales = Decimal(str(refunded_sales))
    cash_received = Decimal(str(cash_received))
    cash_refunded = Decimal(str(cash_refunded))
    cash_adjustments = Decimal(str(cash_adjustments))
    net_sales = sale_total - refunded_sales
    gross_profit = net_sales - Decimal(str(sale_cost)) + Decimal(str(returned_cost)) if not missing_sale_cost and not missing_return_cost else None
    net_profit = gross_profit + Decimal(str(other_income)) - Decimal(str(expenses)) if gross_profit is not None else None
    return {
        "sales": float(sale_total), "returns": float(refunded_sales), "net_sales": float(net_sales),
        "completed_orders": completed_orders, "gross_profit": float(gross_profit) if gross_profit is not None else None,
        "net_profit": float(net_profit) if net_profit is not None else None,
        "expenses": float(expenses), "other_income": float(other_income),
        "cash_receipts": float(cash_received), "cash_refunds": float(cash_refunded),
        "cash_adjustments": float(cash_adjustments),
        "cash_movement": float(cash_received - cash_refunded + cash_adjustments), "customer_debt": float(customer_debt),
        "profit_incomplete": bool(missing_sale_cost or missing_return_cost),
    }


async def daily_sales_trend(db: AsyncSession, days: int = 14, end_day: date | None = None) -> list[dict]:
    """Return a bounded Cairo-day series; aggregate in SQL and fill empty days in Python."""
    if days < 1 or days > 90:
        raise ValueError("days must be between 1 and 90")
    cairo = ZoneInfo("Africa/Cairo")
    last_day = end_day or datetime.now(cairo).date()
    first_day = last_day - timedelta(days=days - 1)
    start = datetime.combine(first_day, time.min, tzinfo=cairo)
    end = datetime.combine(last_day + timedelta(days=1), time.min, tzinfo=cairo)
    postgres = db.get_bind().dialect.name == "postgresql"

    def bucket(column):
        return func.date(func.timezone("Africa/Cairo", column)) if postgres else func.date(column)

    order_day = bucket(Order.created_at)
    return_day = bucket(SalesReturn.created_at)
    sales_rows = (await db.execute(
        select(order_day, func.sum(Order.total_amount))
        .where(Order.status.in_(COMPLETED), Order.created_at >= start, Order.created_at < end)
        .group_by(order_day)
    )).all()
    return_rows = (await db.execute(
        select(return_day, func.sum(SalesReturn.returned_value))
        .where(SalesReturn.created_at >= start, SalesReturn.created_at < end)
        .group_by(return_day)
    )).all()
    sales = {str(day)[:10]: Decimal(str(amount)) for day, amount in sales_rows}
    refunds = {str(day)[:10]: Decimal(str(amount)) for day, amount in return_rows}
    return [{
        "date": (day := first_day + timedelta(days=index)).isoformat(),
        "sales": float(sales.get(day.isoformat(), 0)),
        "returns": float(refunds.get(day.isoformat(), 0)),
        "net": float(sales.get(day.isoformat(), 0) - refunds.get(day.isoformat(), 0)),
    } for index in range(days)]


async def daily_inventory_activity(db: AsyncSession, days: int = 30, end_day: date | None = None) -> list[dict]:
    """Count stock movements rather than summing quantities of unlike products."""
    if days < 1 or days > 90:
        raise ValueError("days must be between 1 and 90")
    cairo = ZoneInfo("Africa/Cairo")
    last_day = end_day or datetime.now(cairo).date()
    first_day = last_day - timedelta(days=days - 1)
    start = datetime.combine(first_day, time.min, tzinfo=cairo)
    end = datetime.combine(last_day + timedelta(days=1), time.min, tzinfo=cairo)
    column = InventoryTransaction.created_at
    bucket = func.date(func.timezone("Africa/Cairo", column)) if db.get_bind().dialect.name == "postgresql" else func.date(column)
    rows = (await db.execute(select(
        bucket,
        func.sum(case((InventoryTransaction.quantity_changed > 0, 1), else_=0)),
        func.sum(case((InventoryTransaction.quantity_changed < 0, 1), else_=0)),
    ).where(column >= start, column < end).group_by(bucket))).all()
    counts = {str(day)[:10]: (int(incoming or 0), int(outgoing or 0)) for day, incoming, outgoing in rows}
    return [{"date": (day := first_day + timedelta(days=index)).isoformat(),
             "incoming": counts.get(day.isoformat(), (0, 0))[0],
             "outgoing": counts.get(day.isoformat(), (0, 0))[1]} for index in range(days)]


async def stock_alerts(db: AsyncSession) -> list[dict]:
    totals = select(
        InventoryBalance.product_id,
        func.sum(InventoryBalance.current_stock).label("stock"),
    ).group_by(InventoryBalance.product_id).subquery()
    stock = func.coalesce(totals.c.stock, 0)
    minimum = func.coalesce(Product.min_stock_level, 0)
    rows = (await db.execute(select(
        Product.id, Product.name_ar, stock, minimum, Product.base_unit, Product.image_url,
    ).outerjoin(totals, totals.c.product_id == Product.id).where(
        Product.is_deleted == False,
        Product.is_active == True,
        or_(stock <= 0, and_(minimum > 0, stock <= minimum), and_(minimum == 0, stock < 5)),
    ).order_by(case((stock <= 0, 0), else_=1), stock, Product.name_ar))).all()
    return [{"product_id": product_id, "name": name, "stock": float(quantity),
             "minimum": float(threshold), "severity": "out" if quantity <= 0 else "low",
             "base_unit": unit, "image_url": image_url}
            for product_id, name, quantity, threshold, unit, image_url in rows]


async def product_sales_activity(db: AsyncSession, start: datetime, end: datetime,
                                 dormant_days: int = 90) -> list[dict]:
    """One row per active physical product; quantities use the product's base unit."""
    now = datetime.now(ZoneInfo("Africa/Cairo"))
    last_sale = dict((await db.execute(select(
        OrderItem.product_id, func.max(Order.created_at),
    ).join(Order, Order.id == OrderItem.order_id).where(
        Order.status.in_(COMPLETED), Order.created_at <= now,
    ).group_by(OrderItem.product_id))).all())
    returns = select(
        SalesReturnLine.order_item_id.label("item_id"),
        func.sum(SalesReturnLine.quantity * OrderItem.conversion_factor).label("quantity"),
    ).join(OrderItem, OrderItem.id == SalesReturnLine.order_item_id).join(
        SalesReturn, SalesReturn.id == SalesReturnLine.return_id,
    ).where(SalesReturn.created_at < end).group_by(SalesReturnLine.order_item_id).subquery()
    sold = (await db.execute(select(
        OrderItem.product_id,
        func.sum(func.greatest(0, OrderItem.quantity_actual - func.coalesce(returns.c.quantity, 0))),
    ).join(Order, Order.id == OrderItem.order_id).outerjoin(
        returns, returns.c.item_id == OrderItem.id,
    ).where(Order.status.in_(COMPLETED), Order.created_at >= start,
            Order.created_at < end).group_by(OrderItem.product_id))).all()
    quantities = dict(sold)
    balances = dict((await db.execute(select(
        InventoryBalance.product_id, func.coalesce(func.sum(InventoryBalance.current_stock), 0),
    ).group_by(InventoryBalance.product_id))).all())
    products = (await db.execute(select(Product.id, Product.name_ar, Product.base_unit,
                                        Product.min_stock_level, Product.created_at).where(
        Product.is_deleted == False, Product.is_active == True, Product.is_bundle == False,
    ))).all()
    period_days = max(1, (end - start).total_seconds() / 86400)
    rows = []
    for product_id, name, unit, minimum, created_at in products:
        last = last_sale.get(product_id)
        days_since = max(0, (now - last).days) if last else None
        age_days = max(0, (now - created_at).days) if created_at else None
        dormant = days_since >= dormant_days if days_since is not None else age_days is not None and age_days >= dormant_days
        stock = Decimal(str(balances.get(product_id, 0)))
        sold_quantity = Decimal(str(quantities.get(product_id, 0)))
        rows.append({"product_id": str(product_id), "name": name, "base_unit": unit,
                     "stock": float(stock), "minimum": float(minimum or 0),
                     "quantity_sold": float(sold_quantity), "daily_rate": round(float(sold_quantity) / period_days, 2),
                     "last_sold_at": last, "days_since_sale": days_since, "never_sold": last is None,
                     "dormant": dormant,
                     "low_stock": stock <= Decimal(str(minimum or 0)) if minimum else stock < 5,
                     "reorder_priority": bool(not dormant and sold_quantity > 0 and
                                              (stock <= Decimal(str(minimum or 0)) if minimum else stock < 5))})
    return rows


async def management_details(db: AsyncSession, now: datetime) -> dict:
    since = now - timedelta(days=30)
    orders = (await db.execute(select(Order).where(
        Order.status.in_(COMPLETED), Order.created_at >= since,
    ))).scalars().all()
    order_ids = [order.id for order in orders]
    by_order = {order.id: order for order in orders}
    items = (await db.execute(select(OrderItem, Product).join(Product, Product.id == OrderItem.product_id).where(
        OrderItem.order_id.in_(order_ids),
    ))).all() if order_ids else []
    returned = dict((await db.execute(select(
        SalesReturnLine.order_item_id, func.sum(SalesReturnLine.amount),
    ).join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id).where(
        SalesReturn.created_at >= since,
    ).group_by(SalesReturnLine.order_item_id))).all())
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
    top_customer_ids = [customer_id for customer_id, _ in sorted(customer_totals.items(), key=lambda row: row[1], reverse=True)[:5]]
    customer_names = dict((await db.execute(select(Customer.id, Customer.name).where(
        Customer.id.in_(top_customer_ids), Customer.is_deleted == False,
    ))).all()) if top_customer_ids else {}
    new_customers = (await db.execute(select(func.count(Customer.id)).where(
        Customer.is_deleted == False, func.date(Customer.created_at) == now.date(),
    ))).scalar_one()
    returning_customers = (await db.execute(select(func.count(Customer.id)).where(
        Customer.is_deleted == False, Customer.purchase_count > 1,
    ))).scalar_one()
    delayed_filter = (
        Order.status == OrderStatusEnum.PREPARING.value,
        Order.preparing_started_at < now - timedelta(hours=2),
    )
    delayed_count = (await db.execute(select(func.count(Order.id)).where(*delayed_filter))).scalar_one()
    delayed = (await db.execute(select(Order.id, Order.assigned_to_id, Order.preparing_started_at)
        .where(*delayed_filter).order_by(Order.preparing_started_at).limit(10))).all()

    supplier_rows = (await db.execute(select(Supplier).where(Supplier.is_deleted == False))).scalars().all()
    receipt_filter = (
        InventoryTransaction.transaction_type == TransactionTypeEnum.RECEIVING,
        InventoryTransaction.supplier_finance_included.is_(True),
    )
    unattributed = (await db.execute(select(func.count()).select_from(InventoryTransaction).where(
        *receipt_filter, InventoryTransaction.supplier_id.is_(None),
        or_(InventoryTransaction.notes.is_(None), InventoryTransaction.notes != "Initial stock from product creation"),
    ))).scalar_one() > 0
    receipts = {supplier_id: (value, bool(missing)) for supplier_id, value, missing in
        (await db.execute(select(
            InventoryTransaction.supplier_id,
            func.coalesce(func.sum(InventoryTransaction.quantity_changed * func.coalesce(InventoryTransaction.unit_cost, 0)), 0),
            func.max(case((InventoryTransaction.unit_cost.is_(None), 1), else_=0)),
        ).where(*receipt_filter).group_by(InventoryTransaction.supplier_id))).all()}
    payments = dict((await db.execute(select(
        SupplierPayment.supplier_id, func.sum(SupplierPayment.amount),
    ).group_by(SupplierPayment.supplier_id))).all())
    debts = dict((await db.execute(select(
        SupplierDebtEntry.supplier_id,
        func.sum(case((SupplierDebtEntry.entry_type == "DEBT", SupplierDebtEntry.amount), else_=-SupplierDebtEntry.amount)),
    ).group_by(SupplierDebtEntry.supplier_id))).all())
    purchase_counts = {supplier_id: (count, received) for supplier_id, count, received in
        (await db.execute(select(
            PurchaseOrder.supplier_id, func.count(PurchaseOrder.id),
            func.sum(case((PurchaseOrder.status == "RECEIVED", 1), else_=0)),
        ).group_by(PurchaseOrder.supplier_id))).all()}
    suppliers = []
    for supplier in supplier_rows:
        received_value, missing_cost = receipts.get(supplier.id, (0, False))
        incomplete = unattributed or missing_cost
        orders_count, received_count = purchase_counts.get(supplier.id, (0, 0))
        suppliers.append({"id": supplier.id, "name": supplier.name,
                          "balance": None if incomplete else float(Decimal(str(supplier.opening_balance or 0)) + Decimal(str(received_value)) + Decimal(str(debts.get(supplier.id, 0))) - Decimal(str(payments.get(supplier.id, 0)))),
                          "statement_incomplete": incomplete, "orders": orders_count,
                          "received_orders": received_count})

    def top(values, name):
        return [{"id": str(key), "name": name(key), "net_sales": float(value)}
                for key, value in sorted(values.items(), key=lambda row: row[1], reverse=True)[:5]]

    return {
        "top_products": top(product_totals, lambda key: key[1]),
        "top_categories": top(category_totals, lambda key: category_names.get(key, "غير مصنف")),
        "top_customers": top(customer_totals, lambda key: customer_names.get(key, "عميل غير متاح")),
        "sales_by_source": {source: float(total) for source, total in sources.items()},
        "new_customers": new_customers,
        "returning_customers": returning_customers,
        "delayed_orders_count": delayed_count,
        "delayed_orders": [{"id": str(order_id), "assigned_to_id": str(assignee) if assignee else None,
                            "hours": round((now - started).total_seconds() / 3600, 1)} for order_id, assignee, started in delayed],
        "suppliers": suppliers,
    }
