"""Record physical counts even when no stock adjustment is needed."""

from alembic import op
import sqlalchemy as sa

revision = "4ea59270db13"
down_revision = "c716b5f9384a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_counts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("warehouse_id", sa.UUID(), sa.ForeignKey("warehouses.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expected_quantity", sa.Numeric(18, 2), nullable=False),
        sa.Column("observed_quantity", sa.Numeric(18, 2), nullable=False),
        sa.Column("difference", sa.Numeric(18, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("observed_quantity >= 0", name="ck_inventory_count_nonnegative"),
    )


def downgrade() -> None:
    raise RuntimeError("Physical count history requires an explicit recovery plan")
