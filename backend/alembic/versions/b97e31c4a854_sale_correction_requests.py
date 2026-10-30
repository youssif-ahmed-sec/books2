"""Track original evidence and proposed sale corrections."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b97e31c4a854"
down_revision = "d86f42a1c093"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sale_corrections",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("requested_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reviewed_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("manual_review", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("review_signature", sa.String(64), nullable=True),
        sa.Column("rereview_requested_signature", sa.String(64), nullable=True),
        sa.Column("original_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("original_fingerprint", sa.String(64), nullable=False),
        sa.Column("proposal", postgresql.JSONB(), nullable=False),
        sa.Column("proposal_fingerprint", sa.String(64), nullable=False),
        sa.Column("priced_lines", postgresql.JSONB(), nullable=False),
        sa.Column("proposed_quote", postgresql.JSONB(), nullable=False),
        sa.Column("corrected_order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("settlement_fingerprint", sa.String(64), nullable=True),
        sa.Column("settlement_breakdown", postgresql.JSONB(), nullable=True),
        sa.Column("settlement_debts", postgresql.JSONB(), nullable=True),
        sa.Column("rejection_reason", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('PENDING', 'AWAITING_SETTLEMENT', 'APPLIED', 'REJECTED', 'WITHDRAWN')", name="ck_sale_correction_status"),
    )
    op.create_index("uq_sale_correction_active_order", "sale_corrections", ["order_id"], unique=True,
                    postgresql_where=sa.text("status IN ('PENDING', 'AWAITING_SETTLEMENT')"))
    op.create_index("ix_sale_correction_status_created", "sale_corrections", ["status", "created_at"])
    op.add_column("payments", sa.Column("correction_id", sa.UUID(), nullable=True))
    op.create_index("ix_payments_correction_id", "payments", ["correction_id"])
    op.execute("ALTER TABLE sale_corrections ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON sale_corrections FROM anon, authenticated")


def downgrade():
    raise RuntimeError("Correction history requires an explicit recovery plan")
