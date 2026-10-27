"""Allow request owners to cancel pending product approvals."""

from alembic import op

revision = "a17e6c92d435"
down_revision = "b64d7a82f310"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_product_approvals_status", "product_approvals", type_="check")
    op.create_check_constraint(
        "ck_product_approvals_status", "product_approvals",
        "status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')",
    )


def downgrade() -> None:
    raise RuntimeError("Cancelled requests require an explicit history recovery plan")
