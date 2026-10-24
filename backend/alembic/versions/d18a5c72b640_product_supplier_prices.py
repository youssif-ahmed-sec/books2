"""One catalog product, supplier sale prices, and guard new duplicate names.

Revision ID: d18a5c72b640
Revises: c7e1a42b9f30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d18a5c72b640"
down_revision = "c7e1a42b9f30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_supplier_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("suppliers.id"), nullable=False),
        sa.UniqueConstraint("product_id", "supplier_id", name="uq_product_supplier_link"),
    )
    op.execute("""
        INSERT INTO product_supplier_links (id, product_id, supplier_id)
        SELECT gen_random_uuid(), product_id, supplier_id FROM (
            SELECT id AS product_id, supplier_id FROM products WHERE supplier_id IS NOT NULL
            UNION
            SELECT product_id, supplier_id FROM inventory_transactions WHERE supplier_id IS NOT NULL
        ) linked
    """)
    op.create_table(
        "product_supplier_prices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("suppliers.id"), nullable=False),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("product_units.id"), nullable=False),
        sa.Column("price_level", postgresql.ENUM(name="pricelevelenum", create_type=False), nullable=False),
        sa.Column("price", sa.Numeric(18, 2), nullable=False),
        sa.CheckConstraint("price >= 0", name="ck_product_supplier_price_nonnegative"),
        sa.UniqueConstraint("product_id", "supplier_id", "unit_id", "price_level", name="uq_product_supplier_unit_level"),
    )
    op.create_index("ix_product_supplier_prices_supplier", "product_supplier_prices", ["supplier_id", "product_id"])
    op.execute("""
        INSERT INTO product_supplier_prices (id, product_id, supplier_id, unit_id, price_level, price)
        SELECT gen_random_uuid(), p.id, p.supplier_id, pp.unit_id, pp.price_level, pp.price
        FROM products p JOIN product_prices pp ON pp.product_id = p.id
        JOIN product_units u ON u.id = pp.unit_id
        WHERE p.supplier_id IS NOT NULL AND pp.is_deleted = false AND u.is_deleted = false
    """)
    # Existing duplicate names can represent separate stocked records. Preserve
    # them until reviewed, while serializing and rejecting any new duplicate.
    op.execute("""
        CREATE FUNCTION enforce_unique_active_product_name() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE normalized_name text;
        BEGIN
            IF NEW.is_deleted IS DISTINCT FROM false OR NEW.is_bundle IS DISTINCT FROM false THEN
                RETURN NEW;
            END IF;
            normalized_name := lower(regexp_replace(btrim(NEW.name_ar), '[[:space:]]+', ' ', 'g'));
            IF TG_OP = 'UPDATE' THEN
                IF OLD.is_deleted IS false AND OLD.is_bundle IS false
                   AND lower(regexp_replace(btrim(OLD.name_ar), '[[:space:]]+', ' ', 'g')) = normalized_name THEN
                    RETURN NEW;
                END IF;
            END IF;
            PERFORM pg_advisory_xact_lock(hashtext(normalized_name)::bigint);
            IF EXISTS (
                SELECT 1 FROM products
                WHERE id IS DISTINCT FROM NEW.id AND is_deleted = false AND is_bundle = false
                  AND lower(regexp_replace(btrim(name_ar), '[[:space:]]+', ' ', 'g')) = normalized_name
            ) THEN
                RAISE EXCEPTION USING ERRCODE = '23505',
                    CONSTRAINT = 'uq_products_active_normalized_ar_name',
                    MESSAGE = 'Duplicate active product name';
            END IF;
            RETURN NEW;
        END $$
    """)
    op.execute("""
        CREATE TRIGGER trg_products_unique_active_name
        BEFORE INSERT OR UPDATE OF name_ar, is_deleted, is_bundle ON products
        FOR EACH ROW EXECUTE FUNCTION enforce_unique_active_product_name()
    """)
    duplicate_names = op.get_bind().scalar(sa.text("""
        SELECT count(*) FROM (
            SELECT lower(regexp_replace(btrim(name_ar), '[[:space:]]+', ' ', 'g'))
            FROM products WHERE is_deleted = false AND is_bundle = false
            GROUP BY 1 HAVING count(*) > 1
        ) duplicates
    """))
    if not duplicate_names:
        op.execute("""
            CREATE UNIQUE INDEX uq_products_active_normalized_ar_name
            ON products (lower(regexp_replace(btrim(name_ar), '[[:space:]]+', ' ', 'g')))
            WHERE is_deleted = false AND is_bundle = false
        """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_products_active_normalized_ar_name")
    op.execute("DROP TRIGGER trg_products_unique_active_name ON products")
    op.execute("DROP FUNCTION enforce_unique_active_product_name()")
    op.drop_index("ix_product_supplier_prices_supplier", table_name="product_supplier_prices")
    op.drop_table("product_supplier_prices")
    op.drop_table("product_supplier_links")
