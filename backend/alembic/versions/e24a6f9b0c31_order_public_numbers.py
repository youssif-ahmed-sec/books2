"""Give every order a stable, readable number for invoices and lookup.

Revision ID: e24a6f9b0c31
Revises: b7c2e913a4d5
"""

from alembic import op
import sqlalchemy as sa


revision = "e24a6f9b0c31"
down_revision = "b7c2e913a4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE orders_public_number_seq START WITH 100001")
    op.add_column("orders", sa.Column("public_number", sa.BigInteger(), nullable=True))
    op.execute("""
        WITH numbered AS (
            SELECT id, 100000 + row_number() OVER (ORDER BY created_at NULLS LAST, id) AS value
            FROM orders
        )
        UPDATE orders SET public_number = numbered.value
        FROM numbered WHERE orders.id = numbered.id
    """)
    op.execute("""
        SELECT setval(
            'orders_public_number_seq',
            COALESCE((SELECT max(public_number) FROM orders), 100001),
            EXISTS (SELECT 1 FROM orders)
        )
    """)
    op.alter_column("orders", "public_number", nullable=False,
                    server_default=sa.text("nextval('orders_public_number_seq'::regclass)"))
    op.create_unique_constraint("uq_orders_public_number", "orders", ["public_number"])
    op.execute("ALTER SEQUENCE orders_public_number_seq OWNED BY orders.public_number")


def downgrade() -> None:
    op.drop_constraint("uq_orders_public_number", "orders", type_="unique")
    op.drop_column("orders", "public_number")
    op.execute("DROP SEQUENCE IF EXISTS orders_public_number_seq")
