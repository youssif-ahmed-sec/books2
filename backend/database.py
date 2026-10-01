import os
import re
import ssl
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
    ca_cert_path = os.getenv("DATABASE_SSL_CA_CERT")
    ssl_context = ssl.create_default_context(cafile=ca_cert_path or None)
    # Supabase Root 2021 CA lacks a key-usage extension, which Python 3.13's
    # strict X.509 flag requires. Opt in only for that legacy provider CA;
    # certificate-chain and hostname verification remain enabled.
    if ca_cert_path and os.getenv("DATABASE_SSL_ALLOW_LEGACY_CA") == "1":
        ssl_context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    connect_args["ssl"] = ssl_context

engine = create_async_engine(DATABASE_URL, echo=False, connect_args=connect_args)

AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
