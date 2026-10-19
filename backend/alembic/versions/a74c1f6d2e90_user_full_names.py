"""Add Arabic employee names without inventing names for existing accounts.

Revision ID: a74c1f6d2e90
Revises: e85f4d2a9c10
"""

from alembic import op
import sqlalchemy as sa

revision = "a74c1f6d2e90"
down_revision = "e85f4d2a9c10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(length=100), nullable=True))
    op.create_check_constraint("ck_users_full_name_not_blank", "users", "full_name IS NULL OR length(btrim(full_name)) >= 2")


def downgrade() -> None:
    op.drop_constraint("ck_users_full_name_not_blank", "users", type_="check")
    op.drop_column("users", "full_name")
