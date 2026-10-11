"""Add customer credit limits and an immutable payment ledger."""

from alembic import op
import sqlalchemy as sa

revision = "6b1a8d4e20c9"
down_revision = "a0819697c160"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("credit_limit", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.create_table(
        "payments",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("customer_id", sa.UUID(), sa.ForeignKey("customers.id"), nullable=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("method", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("amount > 0", name="ck_payment_positive_amount"),
        sa.CheckConstraint("kind IN ('SALE', 'COLLECTION', 'REFUND')", name="ck_payment_kind"),
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"])
    op.create_index("ix_payments_customer_id", "payments", ["customer_id"])


def downgrade() -> None:
    raise RuntimeError("Payment history and credit limits require an explicit recovery plan")
