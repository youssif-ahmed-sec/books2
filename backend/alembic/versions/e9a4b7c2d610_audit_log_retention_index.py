"""Index audit log age for bounded retention cleanup.

Revision ID: e9a4b7c2d610
Revises: c5a92d7e104b
"""

from alembic import op


revision = "e9a4b7c2d610"
down_revision = "c5a92d7e104b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
