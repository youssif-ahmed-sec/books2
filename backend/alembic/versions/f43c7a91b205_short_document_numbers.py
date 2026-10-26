"""Give every printable document a short number from the sales sequence.

Revision ID: f43c7a91b205
Revises: e9a4b7c2d610
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f43c7a91b205"
down_revision = "e9a4b7c2d610"
branch_labels = None
depends_on = None

NEXT_NUMBER = sa.text("nextval('orders_public_number_seq'::regclass)")


def upgrade() -> None:
    for table in ("purchase_documents", "purchase_receipts", "sales_returns"):
        op.add_column(table, sa.Column("public_number", sa.BigInteger(), nullable=True))
    op.create_table(
        "stock_receipt_numbers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("public_number", sa.BigInteger(), nullable=False, server_default=NEXT_NUMBER),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("public_number", name="uq_stock_receipt_numbers_public_number"),
    )

    # The sales sequence is shared so printed numbers stay unique across document types.
    op.execute("""
        SELECT setval('orders_public_number_seq', GREATEST(
            COALESCE((SELECT MAX(public_number) FROM orders), 100000),
            (SELECT last_value FROM orders_public_number_seq)
        ), true)
    """)
    for table in ("purchase_documents", "purchase_receipts", "sales_returns"):
        op.execute(f"UPDATE {table} SET public_number = nextval('orders_public_number_seq'::regclass)")
        op.alter_column(table, "public_number", nullable=False, server_default=NEXT_NUMBER)
        op.create_unique_constraint(f"uq_{table}_public_number", table, ["public_number"])

    op.execute("""
        INSERT INTO stock_receipt_numbers (id, public_number, created_at)
        SELECT receipts.id, nextval('orders_public_number_seq'::regclass), receipts.created_at
        FROM (
            SELECT substring(reference_document FROM 5)::uuid AS id, MIN(created_at) AS created_at
            FROM inventory_transactions
            WHERE reference_document ~* '^RCV-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            GROUP BY substring(reference_document FROM 5)::uuid
        ) AS receipts
    """)


def downgrade() -> None:
    op.drop_table("stock_receipt_numbers")
    for table in ("sales_returns", "purchase_receipts", "purchase_documents"):
        op.drop_constraint(f"uq_{table}_public_number", table, type_="unique")
        op.drop_column(table, "public_number")
