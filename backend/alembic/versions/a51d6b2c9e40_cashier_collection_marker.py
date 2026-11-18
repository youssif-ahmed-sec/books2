"""Track the separate cashier confirmation for newly created POS invoices."""
from alembic import op
import sqlalchemy as sa

revision = "a51d6b2c9e40"
down_revision = "c8a13d4e5f90"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("cashier_collected", sa.Boolean(), nullable=True))
    op.add_column("orders", sa.Column("cashier_expected_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("orders", sa.Column("cashier_collected_by_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("orders", sa.Column("cashier_collected_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM orders WHERE cashier_collected IS NOT NULL) THEN
            RAISE EXCEPTION 'Cannot remove cashier collection tracking while tracked invoices exist';
        END IF;
    END $$""")
    op.drop_column("orders", "cashier_collected_at")
    op.drop_column("orders", "cashier_expected_amount")
    op.drop_column("orders", "cashier_collected_by_id")
    op.drop_column("orders", "cashier_collected")
