"""Keep additional customer addresses and snapshot a sale's selected address.

Revision ID: b93a62e7c501
Revises: a74c1f6d2e90
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "b93a62e7c501"
down_revision = "a74c1f6d2e90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("addresses", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.add_column("orders", sa.Column("customer_address", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "customer_address")
    op.drop_column("customers", "addresses")
