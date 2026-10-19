"""Signal committed changes to management dashboard inputs.

Revision ID: d35a6f1b8c42
Revises: c84e7d1a2b30
"""

from alembic import op

revision = "d35a6f1b8c42"
down_revision = "c84e7d1a2b30"
branch_labels = None
depends_on = None


DASHBOARD_TABLES = (
    "orders", "order_items", "sales_returns", "sales_return_lines",
    "products", "categories", "inventory_balances", "inventory_transactions",
    "payments", "cash_adjustments", "cash_shifts", "customers",
    "expenses", "incomes", "suppliers", "supplier_payments",
    "supplier_debt_entries", "purchase_orders",
)


def upgrade() -> None:
    # Fixed payloads from the same transaction collapse into one notification.
    # PostgreSQL delivers it only after a successful commit.
    op.execute("""
        CREATE FUNCTION books2_notify_dashboard_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            PERFORM pg_notify('books2_dashboard_changed', 'changed');
            RETURN NULL;
        END;
        $$
    """)
    for table in DASHBOARD_TABLES:
        op.execute(f"""
            CREATE TRIGGER trg_dashboard_changed
            AFTER INSERT OR UPDATE OR DELETE ON {table}
            FOR EACH STATEMENT EXECUTE FUNCTION books2_notify_dashboard_change()
        """)


def downgrade() -> None:
    for table in DASHBOARD_TABLES:
        op.execute(f"DROP TRIGGER trg_dashboard_changed ON {table}")
    op.execute("DROP FUNCTION books2_notify_dashboard_change()")
