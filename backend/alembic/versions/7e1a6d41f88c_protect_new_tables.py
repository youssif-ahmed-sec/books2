"""Keep new financial and customer records private from Supabase Data API roles."""

from alembic import op

revision = "7e1a6d41f88c"
down_revision = "437d4aa8af9b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The application uses the privileged server-side database role. Data API
    # roles receive no policies for these tables and cannot read or mutate them.
    for table in (
        "payments",
        "purchase_orders",
        "inventory_counts",
        "sales_returns",
        "sales_return_lines",
        "cash_shifts",
        "cash_adjustments",
        "customer_interactions",
    ):
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    raise RuntimeError("Removing row security requires an explicit access review")
