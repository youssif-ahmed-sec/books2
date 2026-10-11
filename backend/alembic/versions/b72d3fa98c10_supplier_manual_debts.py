"""Separate supplier debt from new warehouse receipts without changing existing balances.

Revision ID: b72d3fa98c10
Revises: 9b7e26c4a19d
"""

from alembic import op
import sqlalchemy as sa


revision = "b72d3fa98c10"
down_revision = "9b7e26c4a19d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing receipts (and receipts written by an older app during rollout)
    # retain the prior financial effect. The new app explicitly writes False.
    op.add_column("inventory_transactions", sa.Column(
        "supplier_finance_included", sa.Boolean(), nullable=False, server_default=sa.true(),
    ))
    op.add_column("supplier_payments", sa.Column("cash_source", sa.String(length=16), nullable=True))
    op.create_check_constraint(
        "ck_supplier_payments_cash_source", "supplier_payments",
        "cash_source IS NULL OR cash_source IN ('SHIFT', 'OUTSIDE_SHIFT')",
    )
    op.create_table(
        "supplier_debt_entries",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("supplier_id", sa.UUID(), sa.ForeignKey("suppliers.id"), nullable=False),
        sa.Column("entry_type", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=False),
        sa.Column("reference_number", sa.String(length=100), nullable=True),
        sa.Column("reverses_entry_id", sa.UUID(), sa.ForeignKey("supplier_debt_entries.id"), nullable=True),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_supplier_debt_entries_positive_amount"),
        sa.CheckConstraint("entry_type IN ('DEBT', 'REVERSAL')", name="ck_supplier_debt_entries_type"),
        sa.UniqueConstraint("reverses_entry_id", name="uq_supplier_debt_entries_reversal"),
    )
    op.create_index("ix_supplier_debt_entries_supplier_created", "supplier_debt_entries", ["supplier_id", "created_at"])
    op.execute("ALTER TABLE supplier_debt_entries ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON supplier_debt_entries FROM anon, authenticated")


def downgrade() -> None:
    raise RuntimeError("Supplier financial history requires an explicit rollback plan")
