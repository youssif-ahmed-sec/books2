"""Bridge the original bookstore schema to the first application migration.

The production database predates Alembic. Preserve its rows and add only the
columns and tables that the original first revision assumed already existed.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0b85f4d0c6a1"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    required = {"categories", "subcategories", "customers", "products", "orders", "users"}
    missing = required - set(inspector.get_table_names())
    if missing:
        raise RuntimeError(f"Legacy baseline tables missing: {', '.join(sorted(missing))}")

    def add_missing(table: str, column: sa.Column) -> None:
        if column.name not in {item["name"] for item in sa.inspect(connection).get_columns(table)}:
            op.add_column(table, column)

    add_missing("customers", sa.Column("whatsapp_number", sa.String(), nullable=True))
    add_missing("customers", sa.Column("city", sa.String(), nullable=True))
    add_missing("customers", sa.Column("customer_type", sa.String(), nullable=False,
                                        server_default="Retail Customer"))
    add_missing("customers", sa.Column("tags", postgresql.JSONB(), nullable=True,
                                        server_default=sa.text("'[]'::jsonb")))
    add_missing("customers", sa.Column("notes", sa.Text(), nullable=True))
    add_missing("customers", sa.Column("purchase_count", sa.Integer(), nullable=False,
                                        server_default="0"))
    add_missing("customers", sa.Column("total_purchases", sa.Numeric(12, 2), nullable=False,
                                        server_default="0"))
    add_missing("customers", sa.Column("average_purchase", sa.Numeric(12, 2), nullable=False,
                                        server_default="0"))
    add_missing("customers", sa.Column("last_purchase_date", sa.DateTime(timezone=True), nullable=True))
    add_missing("customers", sa.Column("favorite_categories", postgresql.JSONB(), nullable=True,
                                        server_default=sa.text("'[]'::jsonb")))

    # The next revision casts this existing text column to the enum.
    postgresql.ENUM(
        "RETAIL", "STUDENT", "TEACHER", "SCHOOL", "NURSERY",
        "SPEECH_THERAPY", "WHOLESALE", "SUPER_WHOLESALE", "VIP",
        name="customertypeenum",
    ).create(connection, checkfirst=True)

    add_missing("products", sa.Column("is_bundle", sa.Boolean(), nullable=False,
                                       server_default=sa.false()))
    add_missing("orders", sa.Column("assigned_to_id", sa.UUID(), nullable=True))
    if not any(item["name"] == "orders_assigned_to_id_fkey"
               for item in sa.inspect(connection).get_foreign_keys("orders")):
        op.create_foreign_key("orders_assigned_to_id_fkey", "orders", "users",
                              ["assigned_to_id"], ["id"])
    add_missing("orders", sa.Column("source", sa.String(), nullable=False,
                                     server_default="Walk-In Customer"))
    add_missing("orders", sa.Column("shipping_cost", sa.Numeric(12, 2), nullable=False,
                                     server_default="0"))
    if next(item for item in sa.inspect(connection).get_columns("orders")
            if item["name"] == "status")["type"].__class__.__name__ == "ENUM":
        op.execute("ALTER TABLE orders ALTER COLUMN status DROP DEFAULT")
        op.execute("ALTER TABLE orders ALTER COLUMN status TYPE VARCHAR USING status::text")

    if not sa.inspect(connection).has_table("expenses"):
        op.create_table("expenses",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("category", sa.String(), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("expense_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_expenses_category", "expenses", ["category"])
        op.execute("ALTER TABLE expenses ENABLE ROW LEVEL SECURITY")
    if not sa.inspect(connection).has_table("incomes"):
        op.create_table("incomes",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("source", sa.String(), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("income_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_incomes_source", "incomes", ["source"])
        op.execute("ALTER TABLE incomes ENABLE ROW LEVEL SECURITY")
    if not sa.inspect(connection).has_table("product_bundle_components"):
        op.create_table("product_bundle_components",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("bundle_id", sa.UUID(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("component_id", sa.UUID(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("quantity", sa.Numeric(10, 2), nullable=False),
        )
        op.execute("ALTER TABLE product_bundle_components ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    raise RuntimeError("Legacy production baseline cannot be removed safely")
