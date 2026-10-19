"""Persist per-token logout revocation without storing bearer credentials.

Revision ID: a19d6b7c8e20
Revises: f8c1e2a3d4b5
"""

from alembic import op
import sqlalchemy as sa

revision = "a19d6b7c8e20"
down_revision = "f8c1e2a3d4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revoked_access_tokens",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_revoked_access_tokens_expires_at", "revoked_access_tokens", ["expires_at"])
    op.execute("ALTER TABLE revoked_access_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON revoked_access_tokens FROM anon, authenticated")


def downgrade() -> None:
    op.drop_index("ix_revoked_access_tokens_expires_at", table_name="revoked_access_tokens")
    op.drop_table("revoked_access_tokens")
