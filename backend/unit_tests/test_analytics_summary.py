"""Analytics stays accurate on isolated SQLite data without reading production."""

from datetime import datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from models.user import Base
from models.customer import Customer
from models.order import Order, OrderItem, OrderStatusEnum
from models.returns import SalesReturn, SalesReturnLine
from models.financial import Payment, CashShift, CashAdjustment, Expense, Income
from models.inventory import InventoryTransaction, TransactionTypeEnum
from services.analytics_service import financial_summary, daily_sales_trend, daily_inventory_activity
from api.v1.reports import get_sales_report, get_inventory_report


@compiles(JSONB, "sqlite")
def compile_jsonb_for_test(_element, _compiler, **_kwargs):
    return "JSON"


@pytest.mark.asyncio
async def test_aggregates_trends_and_report_pages_are_consistent():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, order_id, item_id, return_id, customer_id, shift_id = [uuid4() for _ in range(6)]
    today = datetime.now(ZoneInfo("Africa/Cairo")).replace(hour=12, minute=0, second=0, microsecond=0)
    async with factory() as db:
        db.add_all([
            Customer(id=customer_id, name="عميل", balance=15),
            Order(id=order_id, user_id=user_id, customer_id=customer_id, status=OrderStatusEnum.CLOSED.value,
                  total_amount=100, source="Walk-In Customer", created_at=today),
            OrderItem(id=item_id, order_id=order_id, product_id=uuid4(), unit_id=uuid4(), quantity_requested=2,
                      quantity_actual=2, conversion_factor=1, price_level="Retail", unit_price=50,
                      total_price=100, cost_at_sale=40),
            SalesReturn(id=return_id, order_id=order_id, warehouse_id=uuid4(), user_id=user_id,
                        kind="REFUND", payment_method="Cash", request_fingerprint="test", returned_value=25,
                        refund_amount=25, charge_amount=0, created_at=today),
            SalesReturnLine(return_id=return_id, order_item_id=item_id, quantity=1, amount=25),
            Payment(user_id=user_id, order_id=order_id, amount=100, method="Cash", kind="SALE", created_at=today),
            Payment(user_id=user_id, order_id=order_id, amount=25, method="Cash", kind="REFUND", created_at=today),
            CashShift(id=shift_id, user_id=user_id, opening_cash=0, status="OPEN"),
            CashAdjustment(shift_id=shift_id, user_id=user_id, amount=-5, reason="test", created_at=today),
            Expense(category="Operations", amount=10, expense_date=today),
            Income(source="Other", amount=5, income_date=today),
            InventoryTransaction(product_id=uuid4(), warehouse_id=uuid4(), user_id=user_id,
                                 transaction_type=TransactionTypeEnum.RECEIVING, quantity_changed=2, created_at=today),
            InventoryTransaction(product_id=uuid4(), warehouse_id=uuid4(), user_id=user_id,
                                 transaction_type=TransactionTypeEnum.ISSUING, quantity_changed=-1, created_at=today),
        ])
        await db.commit()

        summary = await financial_summary(db)
        assert summary["sales"] == 100
        assert summary["returns"] == 25
        assert summary["net_sales"] == 75
        assert summary["gross_profit"] == 55
        assert summary["net_profit"] == 50
        assert summary["cash_movement"] == 70
        assert summary["customer_debt"] == 15
        assert summary["completed_orders"] == 1

        sales_trend = await daily_sales_trend(db, days=7, end_day=today.date())
        inventory_trend = await daily_inventory_activity(db, days=7, end_day=today.date())
        assert sales_trend[-1]["net"] == 75
        assert inventory_trend[-1]["incoming"] == 1
        assert inventory_trend[-1]["outgoing"] == 1
        assert len(sales_trend) == len(inventory_trend) == 7

        sales_page = await get_sales_report(db=db, current_user=None, limit=1, offset=0)
        inventory_page = await get_inventory_report(db=db, current_user=None, limit=1, offset=0)
        assert sales_page["metrics"]["total_revenue"] == 75
        assert sales_page["data"][0]["final_total"] == 100
        assert sales_page["has_more"] is False
        assert len(inventory_page["data"]) == 1
        assert inventory_page["has_more"] is True

        legacy_order_id = uuid4()
        db.add(Order(id=legacy_order_id, user_id=user_id, status=OrderStatusEnum.CLOSED.value,
                     total_amount=10, created_at=today))
        db.add(OrderItem(order_id=legacy_order_id, product_id=uuid4(), unit_id=uuid4(), quantity_requested=1,
                         quantity_actual=1, conversion_factor=1, price_level="Retail", unit_price=10,
                         total_price=10, cost_at_sale=None))
        # A legacy item with missing cost must make profit unknown, never silently zero.
        await db.commit()
        legacy_summary = await financial_summary(db)
        assert legacy_summary["gross_profit"] is None
        assert legacy_summary["profit_incomplete"] is True
    await engine.dispose()
