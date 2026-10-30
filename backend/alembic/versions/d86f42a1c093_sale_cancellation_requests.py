"""Track sale cancellation review and settlement status."""
from alembic import op
import sqlalchemy as sa

revision = "d86f42a1c093"
down_revision = "a17e6c92d435"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sale_cancellations",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("requested_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reviewed_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("manual_review", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("rejection_reason", sa.String(500), nullable=True),
        sa.Column("settlement_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("settlement_debt", sa.Numeric(12, 2), nullable=True),
        sa.Column("settlement_method", sa.String(32), nullable=True),
        sa.Column("review_signature", sa.String(64), nullable=True),
        sa.Column("rereview_requested_signature", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('PENDING', 'AWAITING_SETTLEMENT', 'APPROVED', 'REJECTED')", name="ck_sale_cancellation_status"),
    )
    op.create_index("uq_sale_cancellation_active_order", "sale_cancellations", ["order_id"], unique=True,
                    postgresql_where=sa.text("status IN ('PENDING', 'AWAITING_SETTLEMENT', 'APPROVED')"))
    op.create_index("ix_sale_cancellation_status_created", "sale_cancellations", ["status", "created_at"])
    op.execute("ALTER TABLE sale_cancellations ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON sale_cancellations FROM anon, authenticated")


def downgrade():
    raise RuntimeError("Cancellation history requires an explicit recovery plan")
