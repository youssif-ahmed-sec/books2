"""Store administrator recipient and immutable shift report delivery state.

Revision ID: c84e7d1a2b30
Revises: b7c2e913a4d5
"""

from alembic import op
import sqlalchemy as sa

revision = "c84e7d1a2b30"
down_revision = "b7c2e913a4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shift_report_recipient",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "shift_email_reports",
        sa.Column("shift_id", sa.UUID(), sa.ForeignKey("cash_shifts.id"), primary_key=True),
        sa.Column("recipient_email", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), server_default="PENDING", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('PENDING', 'SENT', 'FAILED')", name="ck_shift_email_status"),
    )
    op.execute("ALTER TABLE shift_report_recipient ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE shift_email_reports ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON shift_report_recipient, shift_email_reports FROM anon, authenticated")


def downgrade() -> None:
    op.drop_table("shift_email_reports")
    op.drop_table("shift_report_recipient")
