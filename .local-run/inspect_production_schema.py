"""Read-only production migration preflight; password is read from stdin."""
import asyncio
import getpass
from pathlib import Path
import ssl
import asyncpg


async def main():
    password = getpass.getpass("Production database password: ")
    if not password:
        raise RuntimeError("Missing password")
    cert = Path(__file__).resolve().parents[1] / "backend" / "certs" / "supabase-root-2021.crt"
    context = ssl.create_default_context(cafile=str(cert))
    context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    connection = await asyncpg.connect(host="aws-0-us-east-1.pooler.supabase.com", port=5432,
        user="postgres.htdudqglmohxikoiqbdq", password=password, database="postgres", ssl=context, timeout=15)
    try:
        async with connection.transaction(readonly=True):
            identity = await connection.fetchrow("SELECT current_database() AS db, current_user AS role")
            revisions = await connection.fetch("SELECT version_num FROM alembic_version")
            objects = await connection.fetchrow("SELECT to_regclass('public.sale_cancellations') AS cancellations, to_regclass('public.sale_corrections') AS corrections")
            column = await connection.fetchval("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='correction_id'")
            print(f"database={identity['db']} role={identity['role']} revisions={[row['version_num'] for row in revisions]}")
            print(f"cancellations={objects['cancellations']} corrections={objects['corrections']} payment_correction_column={column}")
            seasonal = await connection.fetchrow("SELECT timezone('Africa/Cairo', timestamptz '2026-04-23 21:59:59+00') AS spring_before, timezone('Africa/Cairo', timestamptz '2026-04-23 22:00:00+00') AS spring_after, timezone('Africa/Cairo', timestamptz '2026-10-29 20:59:59+00') AS autumn_before, timezone('Africa/Cairo', timestamptz '2026-10-29 21:00:00+00') AS autumn_after")
            print("production PostgreSQL Cairo time:", *(f"{key}={seasonal[key].isoformat()}" for key in seasonal.keys()))
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main())
