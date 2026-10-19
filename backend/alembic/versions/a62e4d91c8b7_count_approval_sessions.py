"""Hold count differences for per-product manager review."""

from alembic import op
import sqlalchemy as sa


revision = "a62e4d91c8b7"
down_revision = "b7c2e913a4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_count_sessions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("warehouse_id", sa.UUID(), sa.ForeignKey("warehouses.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("ALTER TABLE inventory_count_sessions ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON inventory_count_sessions FROM anon, authenticated")
    op.add_column("inventory_counts", sa.Column("session_id", sa.UUID(), sa.ForeignKey("inventory_count_sessions.id"), nullable=True))
    op.add_column("inventory_counts", sa.Column("reason", sa.String(500), nullable=True))
    op.add_column("inventory_counts", sa.Column("status", sa.String(16), nullable=False, server_default="APPROVED"))
    op.add_column("inventory_counts", sa.Column("request_fingerprint", sa.String(64), nullable=True))
    op.add_column("inventory_counts", sa.Column("unit_cost", sa.Numeric(18, 2), nullable=True))
    op.add_column("inventory_counts", sa.Column("reviewed_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("inventory_counts", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("inventory_counts", sa.Column("rejection_reason", sa.String(500), nullable=True))
    op.create_index("ix_inventory_counts_session_id", "inventory_counts", ["session_id"])
    op.create_index("ix_inventory_counts_status_created", "inventory_counts", ["status", "created_at"])
    op.create_index("ix_inventory_counts_product_created", "inventory_counts", ["product_id", "created_at"])
    op.execute("""ALTER TABLE inventory_counts ADD CONSTRAINT ck_inventory_count_status
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))""")


def downgrade() -> None:
    raise RuntimeError("Count approval history requires an explicit recovery plan")
