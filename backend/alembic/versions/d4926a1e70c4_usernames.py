"""Add an optional unique login username to local users.

Revision ID: d4926a1e70c4
Revises: b72d3fa98c10
"""

from alembic import op
import sqlalchemy as sa

revision = "d4926a1e70c4"
down_revision = "b72d3fa98c10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(length=50), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_check_constraint("ck_users_username_format", "users", "username IS NULL OR (username ~ '^[a-z0-9._-]{3,50}$' AND username = lower(username))")


def downgrade() -> None:
    op.drop_constraint("ck_users_username_format", "users", type_="check")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
