"""Manual CRM communication and follow-up history."""

from alembic import op
import sqlalchemy as sa

revision = "e419292731b3"
down_revision = "199c8d4ee582"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("customer_interactions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("customer_id", sa.UUID(), sa.ForeignKey("customers.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("follow_up_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_customer_interactions_customer_id", "customer_interactions", ["customer_id"])


def downgrade() -> None:
    raise RuntimeError("CRM history requires an explicit recovery plan")
