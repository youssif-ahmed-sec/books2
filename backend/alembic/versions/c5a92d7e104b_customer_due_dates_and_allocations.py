"""Track new credit invoices, their collections, and durable overdue alerts.

Historical customer balances have no reliable invoice allocations or due dates,
so this revision deliberately leaves their new fields NULL.
"""

from alembic import op
import sqlalchemy as sa

revision = "c5a92d7e104b"
down_revision = "d18a5c72b640"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("request_fingerprint", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("next_due_date", sa.Date(), nullable=True))
    op.add_column("orders", sa.Column("deferred_remaining", sa.Numeric(12, 2), nullable=True))
    op.create_check_constraint("ck_orders_deferred_remaining_nonnegative", "orders", "deferred_remaining IS NULL OR deferred_remaining >= 0")
    op.create_index("ix_orders_open_due", "orders", ["next_due_date"], postgresql_where=sa.text("deferred_remaining > 0"))
    op.create_table(
        "customer_debt_allocations",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("payment_id", sa.UUID(), sa.ForeignKey("payments.id"), nullable=False),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_customer_debt_allocation_positive"),
        sa.UniqueConstraint("payment_id", "order_id", name="uq_customer_debt_allocation_payment_order"),
    )
    op.create_index("ix_customer_debt_allocations_order", "customer_debt_allocations", ["order_id"])
    op.create_table(
        "customer_due_alerts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("email_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_attempts", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("email_last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_last_error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("order_id", "due_date", "user_id", name="uq_customer_due_alert_order_date_user"),
    )
    op.create_index("ix_customer_due_alerts_email_pending", "customer_due_alerts", ["email_sent_at", "created_at"])
    for table in ("customer_debt_allocations", "customer_due_alerts"):
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'REVOKE ALL ON "{table}" FROM anon, authenticated')


def downgrade() -> None:
    raise RuntimeError("Customer debt allocations and alerts need an explicit financial rollback plan")
