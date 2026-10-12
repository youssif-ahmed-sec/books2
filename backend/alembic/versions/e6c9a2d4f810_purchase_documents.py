"""Add multi-line purchase documents without rewriting legacy orders."""

from alembic import op
import sqlalchemy as sa

revision = "e6c9a2d4f810"
down_revision = "f72a8c4d1e20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "purchase_documents",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("supplier_id", sa.UUID(), sa.ForeignKey("suppliers.id"), nullable=False),
        sa.Column("supplier_name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="REQUESTED"),
        sa.Column("note", sa.String(500)),
        sa.Column("requested_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by", sa.UUID(), sa.ForeignKey("users.id")),
        sa.Column("ordered_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('REQUESTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED')", name="ck_purchase_documents_status"),
        sa.UniqueConstraint("request_id", name="uq_purchase_documents_request_id"),
    )
    op.create_index("ix_purchase_documents_supplier_created", "purchase_documents", ["supplier_id", "created_at"])
    op.create_table(
        "purchase_document_lines",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("document_id", sa.UUID(), sa.ForeignKey("purchase_documents.id"), nullable=False),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("unit_id", sa.UUID(), sa.ForeignKey("product_units.id"), nullable=False),
        sa.Column("product_name", sa.String(200), nullable=False),
        sa.Column("unit_name", sa.String(100), nullable=False),
        sa.Column("base_unit_name", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 2), nullable=False),
        sa.Column("conversion_factor", sa.Numeric(18, 2), nullable=False),
        sa.Column("base_quantity", sa.Numeric(18, 2), nullable=False),
        sa.Column("received_base_quantity", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("quantity > 0 AND conversion_factor > 0 AND base_quantity > 0", name="ck_purchase_document_lines_positive"),
        sa.CheckConstraint("received_base_quantity >= 0 AND received_base_quantity <= base_quantity", name="ck_purchase_document_lines_received"),
        sa.UniqueConstraint("document_id", "product_id", "unit_id", name="uq_purchase_document_product_unit"),
    )
    op.create_index("ix_purchase_document_lines_document", "purchase_document_lines", ["document_id"])
    op.create_table(
        "purchase_receipts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("document_id", sa.UUID(), sa.ForeignKey("purchase_documents.id"), nullable=False),
        sa.Column("warehouse_id", sa.UUID(), sa.ForeignKey("warehouses.id"), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("received_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("request_id", name="uq_purchase_receipts_request_id"),
    )
    op.create_index("ix_purchase_receipts_document", "purchase_receipts", ["document_id", "created_at"])
    op.create_table(
        "purchase_receipt_lines",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("receipt_id", sa.UUID(), sa.ForeignKey("purchase_receipts.id"), nullable=False),
        sa.Column("document_line_id", sa.UUID(), sa.ForeignKey("purchase_document_lines.id"), nullable=False),
        sa.Column("base_quantity", sa.Numeric(18, 2), nullable=False),
        sa.CheckConstraint("base_quantity > 0", name="ck_purchase_receipt_lines_positive"),
        sa.UniqueConstraint("receipt_id", "document_line_id", name="uq_purchase_receipt_document_line"),
    )
    for table in ("purchase_documents", "purchase_document_lines", "purchase_receipts", "purchase_receipt_lines"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON {table} FROM anon, authenticated")


def downgrade() -> None:
    raise RuntimeError("Purchase and receipt history requires an explicit recovery plan")
