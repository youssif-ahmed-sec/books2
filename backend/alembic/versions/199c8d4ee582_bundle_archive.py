"""Archive removed bundle components instead of deleting history."""

from alembic import op
import sqlalchemy as sa

revision = "199c8d4ee582"
down_revision = "8ba150cb727e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product_bundle_components", sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("product_bundle_components", "is_deleted")
