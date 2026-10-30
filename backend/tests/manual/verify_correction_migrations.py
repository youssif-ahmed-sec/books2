"""Validate pending DDL on the identified test database, rolling everything back."""
import asyncio
import importlib.util
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

root = Path(__file__).resolve().parents[3]
backend = root / "backend"
settings = dotenv_values(backend / ".env")
target = urlsplit(settings.get("DATABASE_URL") or "")
if not (target.hostname == "aws-0-eu-west-1.pooler.supabase.com"
        and target.username == "postgres.nxdyxkvqiamjodmnetvs" and target.port == 6543):
    raise RuntimeError("Refusing to test migrations outside the confirmed test database")
os.environ.update({key: value for key, value in settings.items() if value is not None})
os.environ["DATABASE_SSL_CA_CERT"] = str(backend / "certs" / "supabase-root-2021.crt")
os.environ["DATABASE_SSL_ALLOW_LEGACY_CA"] = "1"
sys.path.insert(0, str(backend))
from database import engine
from sqlalchemy import text
from alembic.migration import MigrationContext
from alembic.operations import Operations


def migrate(connection):
    operations = Operations(MigrationContext.configure(connection))
    for filename in ("d86f42a1c093_sale_cancellation_requests.py", "b97e31c4a854_sale_correction_requests.py"):
        spec = importlib.util.spec_from_file_location("test_migration", backend / "alembic" / "versions" / filename)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.op = operations
        module.upgrade()


async def main():
    async with engine.connect() as connection:
        revision = (await connection.execute(text("select version_num from alembic_version"))).scalar_one()
        assert revision == "a17e6c92d435", f"Unexpected test schema revision: {revision}"
        assert (await connection.execute(text("select to_regclass('public.sale_corrections')"))).scalar_one() is None
        await connection.rollback()
        transaction = await connection.begin()
        try:
            await connection.run_sync(migrate)
            for table, column in (("sale_corrections", "settlement_debts"), ("payments", "correction_id")):
                assert (await connection.execute(text("select count(*) from information_schema.columns where table_schema='public' and table_name=:table and column_name=:column"), {"table": table, "column": column})).scalar_one() == 1
            print("Both migrations and expected columns validated on test database")
        finally:
            await transaction.rollback()
        assert (await connection.execute(text("select to_regclass('public.sale_corrections')"))).scalar_one() is None
        print("Migration transaction rolled back")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
