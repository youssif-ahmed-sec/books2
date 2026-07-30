import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

import urllib.parse

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/postgres"

# Ensure asyncpg is used for the async engine
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Check and extract sslmode to avoid TypeError: connect() got an unexpected keyword argument 'sslmode'
connect_args = {}
if "sslmode=" in DATABASE_URL:
    url_parts = urllib.parse.urlparse(DATABASE_URL)
    query_params = urllib.parse.parse_qs(url_parts.query)
    sslmode = query_params.pop("sslmode", [None])[0]
    
    # Reconstruct the URL without sslmode
    new_query = urllib.parse.urlencode(query_params, doseq=True)
    url_parts = url_parts._replace(query=new_query)
    DATABASE_URL = urllib.parse.urlunparse(url_parts)
    
    # Configure ssl parameter based on sslmode value
    if sslmode in ("require", "verify-ca", "verify-full", "prefer"):
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = ssl_context

engine = create_async_engine(DATABASE_URL, echo=False, connect_args=connect_args)

AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
