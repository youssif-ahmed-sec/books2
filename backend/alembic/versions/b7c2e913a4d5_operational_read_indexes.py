"""Indexes for customer metrics, shift totals, and stock alert reads.

Revision ID: b7c2e913a4d5
Revises: a19d6b7c8e20
"""

from alembic import op

revision = "b7c2e913a4d5"
down_revision = "a19d6b7c8e20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_orders_customer_status", "orders", ["customer_id", "status"])
    op.create_index("ix_sales_returns_exchange_order_id", "sales_returns", ["exchange_order_id"])
    op.create_index("ix_cash_adjustments_shift_id", "cash_adjustments", ["shift_id"])


def downgrade() -> None:
    op.drop_index("ix_cash_adjustments_shift_id", table_name="cash_adjustments")
    op.drop_index("ix_sales_returns_exchange_order_id", table_name="sales_returns")
    op.drop_index("ix_orders_customer_status", table_name="orders")
