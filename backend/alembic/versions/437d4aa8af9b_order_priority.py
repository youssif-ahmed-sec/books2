"""Manual lead and order priority."""

from alembic import op
import sqlalchemy as sa

revision = "437d4aa8af9b"
down_revision = "4264a2f66018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("priority", sa.String(), nullable=False, server_default="Normal"))


def downgrade() -> None:
    op.drop_column("orders", "priority")
