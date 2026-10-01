"""Store supplier and purchase cost at receipt time.

Existing receipt rows intentionally remain NULL: their historical values cannot
be inferred from the current product record.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c6d7a91b2f30"
down_revision = "319354c1968f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_transactions", sa.Column("supplier_id", postgresql.UUID(as_uuid=True)))
    op.add_column("inventory_transactions", sa.Column("unit_cost", sa.Numeric(18, 2)))
    op.create_foreign_key(
        "fk_inventory_transactions_supplier_id",
        "inventory_transactions",
        "suppliers",
        ["supplier_id"],
        ["id"],
    )


def downgrade() -> None:
    raise RuntimeError("Receipt cost history cannot be discarded by a downgrade")
