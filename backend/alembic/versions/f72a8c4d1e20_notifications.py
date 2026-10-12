"""Add private per-user application notifications.

Revision ID: f72a8c4d1e20
Revises: d4926a1e70c4
"""

from alembic import op
import sqlalchemy as sa

revision = "f72a8c4d1e20"
down_revision = "d4926a1e70c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("href", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])
    op.execute("ALTER TABLE notifications ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON notifications FROM anon, authenticated")


def downgrade() -> None:
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_table("notifications")
