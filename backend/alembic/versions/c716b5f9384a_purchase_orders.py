"""Add approved purchase orders with tracked receipts."""

from alembic import op
import sqlalchemy as sa

revision = "c716b5f9384a"
down_revision = "928d76bc8b12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "purchase_orders",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("supplier_id", sa.UUID(), sa.ForeignKey("suppliers.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 2), nullable=False),
        sa.Column("received_quantity", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(), nullable=False, server_default="REQUESTED"),
        sa.Column("requested_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_order_quantity_positive"),
        sa.CheckConstraint("received_quantity >= 0 AND received_quantity <= quantity", name="ck_purchase_order_received_range"),
        sa.CheckConstraint("status IN ('REQUESTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED')", name="ck_purchase_order_status"),
    )


def downgrade() -> None:
    raise RuntimeError("Purchase history requires an explicit recovery plan")
