"""Cashier shifts, drawer movements, and payment attribution."""

from alembic import op
import sqlalchemy as sa

revision = "f237a8834e16"
down_revision = "572dc0e9a682"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("cash_shifts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("opening_cash", sa.Numeric(12, 2), nullable=False),
        sa.Column("closing_cash", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_cash", sa.Numeric(12, 2), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="OPEN"),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("opening_cash >= 0 AND (closing_cash IS NULL OR closing_cash >= 0)", name="ck_cash_shift_nonnegative"),
    )
    op.create_index("ix_cash_shifts_user_id", "cash_shifts", ["user_id"])
    op.create_index("uq_cash_shift_open_user", "cash_shifts", ["user_id"], unique=True, postgresql_where=sa.text("status = 'OPEN'"))
    op.create_table("cash_adjustments",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("shift_id", sa.UUID(), sa.ForeignKey("cash_shifts.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.add_column("payments", sa.Column("shift_id", sa.UUID(), sa.ForeignKey("cash_shifts.id"), nullable=True))
    op.create_index("ix_payments_shift_id", "payments", ["shift_id"])


def downgrade() -> None:
    raise RuntimeError("Cash register history requires an explicit recovery plan")
