"""add_operational_role_enum_values

Revision ID: f6b2de16fcc4
Revises: 2f1d00776881
Create Date: 2026-10-20 03:00:35.083138

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f6b2de16fcc4'
down_revision: Union[str, Sequence[str], None] = '2f1d00776881'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Older roleenum types can lack the roles already used by application queries.
    op.execute("ALTER TYPE roleenum ADD VALUE IF NOT EXISTS 'CASHIER_ORDERS'")
    op.execute("ALTER TYPE roleenum ADD VALUE IF NOT EXISTS 'INVENTORY_CONTROLLER'")


def downgrade() -> None:
    raise RuntimeError("Removing roleenum labels could invalidate existing users")
