"""reject_negative_inventory_balances

Revision ID: a0819697c160
Revises: af9a291bc03b
Create Date: 2026-10-07 14:30:54.077011

"""
from typing import Sequence, Union

from alembic import op, context
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a0819697c160'
down_revision: Union[str, Sequence[str], None] = 'af9a291bc03b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if not context.is_offline_mode():
        connection = op.get_bind()
        negative = connection.execute(sa.text("SELECT count(*) FROM inventory_balances WHERE current_stock < 0")).scalar_one()
        if negative:
            raise RuntimeError(f"Reconcile {negative} negative inventory balances before applying the nonnegative constraint")
    op.create_check_constraint("ck_inventory_balance_nonnegative", "inventory_balances", "current_stock >= 0")


def downgrade() -> None:
    raise RuntimeError("Removing the nonnegative stock invariant requires an explicit recovery plan")
