import os
import re
import ssl
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/postgres"

connect_args = {"statement_cache_size": 0}

# Detect SSL requirement BEFORE modifying the URL
needs_ssl = bool(re.search(r"sslmode=(require|verify-ca|verify-full|prefer)", DATABASE_URL))

# Strip query params that asyncpg does not accept natively
# sslmode      — asyncpg uses connect_args["ssl"] instead
# target_session_attrs — causes TargetServerAttributeNotMatched on Supabase poolers
for param in ("sslmode", "target_session_attrs"):
    DATABASE_URL = re.sub(rf"[?&]{param}=[^&]*", "", DATABASE_URL)
DATABASE_URL = DATABASE_URL.rstrip("?").rstrip("&")

# Ensure asyncpg dialect is used (SQLAlchemy async requires it)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Set SSL via connect_args (the correct way for asyncpg)
if needs_ssl:
    ca_cert_env = os.getenv("DATABASE_SSL_CA_CERT")
    if ca_cert_env and not Path(ca_cert_env).is_file():
        raise RuntimeError("DATABASE_SSL_CA_CERT does not point to a readable file")
    ca_cert_path = ca_cert_env or None
    database_host = urlsplit(DATABASE_URL).hostname or ""
    uses_bundled_supabase_ca = False
    if not ca_cert_path and database_host.endswith((".supabase.com", ".supabase.co")):
        bundled_ca = Path(__file__).resolve().parent / "certs" / "supabase-root-2021.crt"
        if not bundled_ca.is_file():
            raise RuntimeError("Supabase CA certificate is missing from the application package")
        ca_cert_path = str(bundled_ca)
        uses_bundled_supabase_ca = True
    ssl_context = ssl.create_default_context(cafile=ca_cert_path or None)
    # Supabase Root 2021 CA lacks a key-usage extension, which Python 3.13's
    # strict X.509 flag requires. Opt in only for that legacy provider CA;
    # certificate-chain and hostname verification remain enabled.
    if ca_cert_path and (uses_bundled_supabase_ca or os.getenv("DATABASE_SSL_ALLOW_LEGACY_CA") == "1"):
        ssl_context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    connect_args["ssl"] = ssl_context

pool_size = int(os.getenv("DATABASE_POOL_SIZE", "4"))
max_overflow = int(os.getenv("DATABASE_MAX_OVERFLOW", "2"))
pool_recycle = int(os.getenv("DATABASE_POOL_RECYCLE", "300"))
pool_timeout = int(os.getenv("DATABASE_POOL_TIMEOUT", "15"))

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    pool_size=pool_size,
    max_overflow=max_overflow,
    pool_recycle=pool_recycle,
    pool_pre_ping=True,
    pool_timeout=pool_timeout,
)

AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
