"""Read-only verification for the confirmed nxdy test database."""

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values
from sqlalchemy import text

root = Path(__file__).resolve().parents[1]
backend = root / "backend"
settings = dotenv_values(backend / ".env")
url = settings.get("DATABASE_URL") or ""
target = urlsplit(url)
if not (
    target.hostname == "aws-0-eu-west-1.pooler.supabase.com"
    and target.username == "postgres.nxdyxkvqiamjodmnetvs"
    and target.port == 6543
    and "htdudqglmohxikoiqbdq" not in url
):
    raise RuntimeError("Refusing to query an unexpected database")

os.environ.update({key: value for key, value in settings.items() if value is not None})
os.environ["DATABASE_SSL_CA_CERT"] = str(backend / "certs" / "supabase-root-2021.crt")
os.environ["DATABASE_SSL_ALLOW_LEGACY_CA"] = "1"
sys.path.insert(0, str(backend))

from database import engine  # noqa: E402


async def main() -> None:
    query = text("""
        WITH numbered AS (
            SELECT 'sale' AS kind, public_number FROM orders
            UNION ALL SELECT 'purchase', public_number FROM purchase_documents
            UNION ALL SELECT 'purchase_receipt', public_number FROM purchase_receipts
            UNION ALL SELECT 'return', public_number FROM sales_returns
            UNION ALL SELECT 'stock_receipt', public_number FROM stock_receipt_numbers
        )
        SELECT COUNT(*) AS total, COUNT(DISTINCT public_number) AS distinct_numbers,
               COUNT(*) FILTER (WHERE public_number IS NULL OR public_number < 100001) AS invalid,
               MIN(public_number) AS first_number, MAX(public_number) AS last_number
        FROM numbered
    """)
    async with engine.connect() as connection:
        await connection.execute(text("SET TRANSACTION READ ONLY"))
        revision = (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        counts = (await connection.execute(query)).one()
        print(f"revision={revision} total={counts.total} distinct={counts.distinct_numbers} "
              f"invalid={counts.invalid} range={counts.first_number}-{counts.last_number}")
    await engine.dispose()
    if revision != "f43c7a91b205" or counts.total != counts.distinct_numbers or counts.invalid:
        raise RuntimeError("Document numbering verification failed")


asyncio.run(main())
