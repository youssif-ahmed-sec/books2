from fastapi import Response
from sqlalchemy import create_engine, select, text

from api.v1.products import product_search_filter
from main import root
from models.product import Product


def test_product_search_matches_separate_arabic_words_and_spelling_variants():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE products (id TEXT, sku TEXT, barcode TEXT, name_en TEXT, name_ar TEXT)"))
        connection.execute(text("CREATE TABLE product_units (product_id TEXT, barcode TEXT, is_deleted BOOLEAN)"))
        connection.execute(text("INSERT INTO products VALUES ('1', 'BK-1', NULL, '', 'كتاب اللغة للصف الأول')"))
        connection.execute(text("INSERT INTO products VALUES ('2', 'BK-2', NULL, '', 'كتاب الرياضيات للصف الثاني')"))
        rows = connection.execute(select(Product.name_ar).where(product_search_filter("كتاب الاول"))).scalars().all()
    assert rows == ["كتاب اللغة للصف الأول"]


def test_product_search_matches_name_sku_and_product_or_unit_barcode():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE products (id TEXT, sku TEXT, barcode TEXT, name_en TEXT, name_ar TEXT)"))
        connection.execute(text("CREATE TABLE product_units (product_id TEXT, barcode TEXT, is_deleted BOOLEAN)"))
        connection.execute(text("INSERT INTO products VALUES ('1', 'BK-17', '12345', 'Book', 'كتاب التاريخ')"))
        connection.execute(text("INSERT INTO product_units VALUES ('1', '98765', 0)"))
        for search in ("كتاب", "Book", "BK-17", "12345", "98765"):
            assert connection.execute(select(Product.name_ar).where(product_search_filter(search))).scalars().all() == ["كتاب التاريخ"]


def test_health_does_not_return_database_error_details():
    class FailingSession:
        async def execute(self, _statement):
            raise RuntimeError("private-database-host")

    response = Response()
    request = root(response, FailingSession())
    try:
        request.send(None)
    except StopIteration as completed:
        body = completed.value
    assert response.status_code == 503
    assert body["database"] == "unreachable"
    assert "private-database-host" not in str(body)
