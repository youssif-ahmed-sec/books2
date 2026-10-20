"""pos_wallet_fee_and_discount_percent

Revision ID: 2f1d00776881
Revises: b93a62e7c501
Create Date: 2026-10-20 02:48:25.574483

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f1d00776881'
down_revision: Union[str, Sequence[str], None] = 'b93a62e7c501'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('discount_percent', sa.Numeric(precision=5, scale=2), nullable=True))
    op.add_column('orders', sa.Column('wallet_fee_amount', sa.Numeric(precision=12, scale=2), nullable=False, server_default='0'))
    op.create_check_constraint('ck_orders_discount_percent_range', 'orders', 'discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100')
    op.create_check_constraint('ck_orders_wallet_fee_nonnegative', 'orders', 'wallet_fee_amount >= 0')


def downgrade() -> None:
    op.drop_constraint('ck_orders_wallet_fee_nonnegative', 'orders', type_='check')
    op.drop_constraint('ck_orders_discount_percent_range', 'orders', type_='check')
    op.drop_column('orders', 'wallet_fee_amount')
    op.drop_column('orders', 'discount_percent')
