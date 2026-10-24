"""Store the planned method for collecting a POS invoice's remaining balance.

Revision ID: c7e1a42b9f30
Revises: f6b2de16fcc4
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7e1a42b9f30"
down_revision: Union[str, Sequence[str], None] = "f6b2de16fcc4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("expected_collection_method", sa.String(length=32), nullable=True))
    op.add_column("payments", sa.Column("wallet_fee_amount", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"))
    op.create_check_constraint("ck_payments_wallet_fee_nonnegative", "payments", "wallet_fee_amount >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_payments_wallet_fee_nonnegative", "payments", type_="check")
    op.drop_column("payments", "wallet_fee_amount")
    op.drop_column("orders", "expected_collection_method")
