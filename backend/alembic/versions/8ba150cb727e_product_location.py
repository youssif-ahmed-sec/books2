"""Store the product shelf or warehouse location label."""

from alembic import op
import sqlalchemy as sa

revision = "8ba150cb727e"
down_revision = "f237a8834e16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("warehouse_location", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "warehouse_location")
