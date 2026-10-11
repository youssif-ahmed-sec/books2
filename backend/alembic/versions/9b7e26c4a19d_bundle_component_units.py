"""Store selected unit and price level for offer components.

Revision ID: 9b7e26c4a19d
Revises: 7e1a6d41f88c
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "9b7e26c4a19d"
down_revision = "7e1a6d41f88c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product_bundle_components", sa.Column("unit_id", sa.UUID(), nullable=True))
    op.add_column("product_bundle_components", sa.Column(
        "price_level",
        postgresql.ENUM("RETAIL", "SEMI_WHOLESALE", "WHOLESALE", "SUPER_WHOLESALE", "VIP",
                        name="pricelevelenum", create_type=False),
        nullable=True,
    ))
    op.create_foreign_key(
        "fk_bundle_component_unit", "product_bundle_components", "product_units",
        ["unit_id"], ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_bundle_component_unit", "product_bundle_components", type_="foreignkey")
    op.drop_column("product_bundle_components", "price_level")
    op.drop_column("product_bundle_components", "unit_id")
