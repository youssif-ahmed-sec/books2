"""Freeze item cost and tax rates for invoices and profit reports."""

from alembic import op
import sqlalchemy as sa

revision = "928d76bc8b12"
down_revision = "6b1a8d4e20c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("cost_at_sale", sa.Numeric(12, 2), nullable=True))
    op.add_column("order_items", sa.Column("tax_rate", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    raise RuntimeError("Historical cost and tax snapshots cannot be discarded safely")
