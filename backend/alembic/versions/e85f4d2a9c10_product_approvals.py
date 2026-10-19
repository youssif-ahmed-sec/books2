"""Queue product edits and deletions for manager approval."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "e85f4d2a9c10"
down_revision = "d71f3a0b65c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_approvals",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("requested_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("product_name", sa.String(), nullable=False),
        sa.Column("baseline_hash", sa.String(64), nullable=False),
        sa.Column("baseline", JSONB(), nullable=False),
        sa.Column("proposed", JSONB(), nullable=True),
        sa.Column("reviewed_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("action IN ('UPDATE', 'DELETE')", name="ck_product_approvals_action"),
        sa.CheckConstraint("status IN ('PENDING', 'APPROVED', 'REJECTED')", name="ck_product_approvals_status"),
    )
    op.create_index("ix_product_approvals_status_created", "product_approvals", ["status", "created_at"])
    op.create_index("uq_product_approvals_pending_product", "product_approvals", ["product_id"],
                    unique=True, postgresql_where=sa.text("status = 'PENDING'"))
    op.execute("ALTER TABLE product_approvals ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON product_approvals FROM anon, authenticated")


def downgrade() -> None:
    raise RuntimeError("Product approval history requires an explicit recovery plan")
