"""Allow product-only purchase requests until the manager completes them.

Revision ID: b64d7a82f310
Revises: f43c7a91b205
"""

from alembic import op
import sqlalchemy as sa


revision = "b64d7a82f310"
down_revision = "f43c7a91b205"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("purchase_documents", "supplier_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("purchase_document_lines", "quantity", existing_type=sa.Numeric(18, 2), nullable=True)
    op.alter_column("purchase_document_lines", "base_quantity", existing_type=sa.Numeric(18, 2), nullable=True)
    op.create_check_constraint(
        "ck_purchase_documents_approved_supplier",
        "purchase_documents",
        "status IN ('REQUESTED', 'REJECTED', 'CANCELLED') OR supplier_id IS NOT NULL",
    )


def downgrade():
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM purchase_documents WHERE supplier_id IS NULL)
                OR EXISTS (SELECT 1 FROM purchase_document_lines WHERE quantity IS NULL OR base_quantity IS NULL)
            THEN
                RAISE EXCEPTION 'Complete open purchase request drafts before downgrade';
            END IF;
        END $$;
    """)
    op.drop_constraint("ck_purchase_documents_approved_supplier", "purchase_documents", type_="check")
    op.alter_column("purchase_document_lines", "base_quantity", existing_type=sa.Numeric(18, 2), nullable=False)
    op.alter_column("purchase_document_lines", "quantity", existing_type=sa.Numeric(18, 2), nullable=False)
    op.alter_column("purchase_documents", "supplier_id", existing_type=sa.UUID(), nullable=False)
