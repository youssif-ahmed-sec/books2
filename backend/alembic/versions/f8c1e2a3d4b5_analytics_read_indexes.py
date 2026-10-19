"""Indexes for bounded analytics and report pagination.

Revision ID: f8c1e2a3d4b5
Revises: e6c9a2d4f810
"""

from alembic import op

revision = "f8c1e2a3d4b5"
down_revision = "e6c9a2d4f810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_orders_status_created", "orders", ["status", "created_at"])
    op.create_index("ix_orders_created_id", "orders", ["created_at", "id"])
    op.create_index("ix_sales_returns_created_at", "sales_returns", ["created_at"])
    op.create_index("ix_inventory_transactions_created_id", "inventory_transactions", ["created_at", "id"])
    op.create_index("ix_payments_created_at", "payments", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_payments_created_at", table_name="payments")
    op.drop_index("ix_inventory_transactions_created_id", table_name="inventory_transactions")
    op.drop_index("ix_sales_returns_created_at", table_name="sales_returns")
    op.drop_index("ix_orders_created_id", table_name="orders")
    op.drop_index("ix_orders_status_created", table_name="orders")
