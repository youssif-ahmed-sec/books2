"""inventory_order_invariants

Revision ID: af9a291bc03b
Revises: c6d7a91b2f30
Create Date: 2026-10-07 14:29:14.037546

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'af9a291bc03b'
down_revision: Union[str, Sequence[str], None] = 'c6d7a91b2f30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("bundle_components_snapshot", sa.JSON(), nullable=True))
    op.add_column("orders", sa.Column("request_id", sa.UUID(), nullable=True))
    op.add_column("orders", sa.Column("request_fingerprint", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_orders_request_id", "orders", ["request_id"])
    op.add_column("inventory_transactions", sa.Column("request_id", sa.UUID(), nullable=True))
    op.add_column("inventory_transactions", sa.Column("request_fingerprint", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_inventory_transactions_request_id", "inventory_transactions", ["request_id"])
    op.create_unique_constraint("uq_inventory_balance_product_warehouse", "inventory_balances", ["product_id", "warehouse_id"])


def downgrade() -> None:
    raise RuntimeError("Order bundle snapshots and request identities cannot be discarded safely")
