"""Allow Instapay and wallet supplier payments while retaining historical methods."""

from alembic import op


revision = "b93e4c2a8d17"
down_revision = "a62e4d91c8b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE paymentmethodenum ADD VALUE IF NOT EXISTS 'INSTAPAY'")
    op.execute("ALTER TYPE paymentmethodenum ADD VALUE IF NOT EXISTS 'WALLET'")


def downgrade() -> None:
    # Existing rows may use these enum labels; PostgreSQL cannot safely remove them.
    pass
