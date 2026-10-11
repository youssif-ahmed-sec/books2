"""Track preparation delay independently of unrelated order edits."""

from alembic import op
import sqlalchemy as sa

revision = "4264a2f66018"
down_revision = "e419292731b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("preparing_started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "preparing_started_at")
