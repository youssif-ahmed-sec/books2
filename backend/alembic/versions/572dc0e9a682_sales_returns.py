"""Track partial refunds and exchanges without rewriting historical orders."""

from alembic import op
import sqlalchemy as sa

revision = "572dc0e9a682"
down_revision = "4ea59270db13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_returns",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("exchange_order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("warehouse_id", sa.UUID(), sa.ForeignKey("warehouses.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("payment_method", sa.String(), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("refund_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("charge_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("returned_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("replacement_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("refund_amount >= 0 AND charge_amount >= 0", name="ck_return_amounts_nonnegative"),
        sa.CheckConstraint("kind IN ('REFUND', 'EXCHANGE')", name="ck_return_kind"),
    )
    op.create_table(
        "sales_return_lines",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("return_id", sa.UUID(), sa.ForeignKey("sales_returns.id"), nullable=False),
        sa.Column("order_item_id", sa.UUID(), sa.ForeignKey("order_items.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_return_line_quantity_positive"),
    )
    op.create_index("ix_sales_returns_order_id", "sales_returns", ["order_id"])
    op.create_index("ix_sales_return_lines_order_item_id", "sales_return_lines", ["order_item_id"])


def downgrade() -> None:
    raise RuntimeError("Return and exchange history requires an explicit recovery plan")
