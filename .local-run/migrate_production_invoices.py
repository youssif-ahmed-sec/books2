"""Apply the two invoice migrations atomically to the identified production project."""
import asyncio
import getpass
import os
import sys
from pathlib import Path
from urllib.parse import quote

root = Path(__file__).resolve().parents[1]
backend = root / "backend"
password = getpass.getpass("Production database password: ")
if not password:
    raise RuntimeError("Missing password")
os.environ["DATABASE_URL"] = "postgresql://postgres.htdudqglmohxikoiqbdq:" + quote(password, safe="") + "@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full"
os.environ["DATABASE_SSL_CA_CERT"] = str(backend / "certs" / "supabase-root-2021.crt")
os.environ["DATABASE_SSL_ALLOW_LEGACY_CA"] = "1"
sys.path.insert(0, str(backend))
os.chdir(backend)
from sqlalchemy import text
from alembic import command
from alembic.config import Config
from database import engine


def upgrade(connection):
    config = Config(str(backend / "alembic.ini"))
    config.attributes["connection"] = connection
    command.upgrade(config, "b97e31c4a854")


async def inspect(connection):
    return (await connection.execute(text("SELECT (SELECT version_num FROM alembic_version) AS revision, "
        "to_regclass('public.sale_cancellations') AS cancellations, to_regclass('public.sale_corrections') AS corrections, "
        "(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='correction_id') AS payment_column, "
        "(SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('public.sale_cancellations'), to_regclass('public.sale_corrections')) AND relrowsecurity) AS protected_tables"))).one()


async def main():
    async with engine.connect() as connection:
        async with connection.begin():
            await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
            await connection.execute(text("SET LOCAL statement_timeout = '45s'"))
            identity = (await connection.execute(text("SELECT current_database(), current_user"))).one()
            before = await inspect(connection)
            if identity[0] != "postgres" or identity[1] != "postgres" or before.revision != "a17e6c92d435" or before.cancellations or before.corrections or before.payment_column:
                raise RuntimeError("Unexpected database identity or schema; no migration applied")
            await connection.run_sync(upgrade)
            after = await inspect(connection)
            if (after.revision != "b97e31c4a854" or not after.cancellations or not after.corrections
                    or after.payment_column != 1 or after.protected_tables != 2):
                raise RuntimeError("Post-migration validation failed; rolling back")
        verified = await inspect(connection)
        if verified.revision != "b97e31c4a854" or verified.protected_tables != 2:
            raise RuntimeError("Committed migration verification failed")
        print("Production migration committed and verified: b97e31c4a854; invoice tables protected")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
