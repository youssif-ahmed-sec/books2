"""Add due dates and explicit supplier payment allocations.

Revision ID: e52b74c9a610
Revises: b93e4c2a8d17
"""

from alembic import op
import sqlalchemy as sa

revision = "e52b74c9a610"
down_revision = "b93e4c2a8d17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Historical debts keep an unknown due date; inventing one would misstate ageing.
    op.add_column("supplier_debt_entries", sa.Column("due_date", sa.Date(), nullable=True))
    op.create_index("ix_supplier_debt_entries_due_date", "supplier_debt_entries", ["supplier_id", "due_date"])
    op.create_table(
        "supplier_payment_allocations",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("payment_id", sa.UUID(), sa.ForeignKey("supplier_payments.id"), nullable=False),
        sa.Column("debt_entry_id", sa.UUID(), sa.ForeignKey("supplier_debt_entries.id"), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_supplier_payment_allocations_positive"),
        sa.UniqueConstraint("payment_id", "debt_entry_id", name="uq_supplier_payment_debt_allocation"),
    )
    op.create_index("ix_supplier_payment_allocations_debt", "supplier_payment_allocations", ["debt_entry_id"])
    op.execute("ALTER TABLE supplier_payment_allocations ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON supplier_payment_allocations FROM anon, authenticated")


def downgrade() -> None:
    raise RuntimeError("Supplier payment allocations require an explicit financial rollback plan")
