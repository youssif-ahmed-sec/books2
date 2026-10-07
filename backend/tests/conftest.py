import os
import pytest
import asyncio
from dotenv import load_dotenv
from sqlalchemy.engine import make_url

# Load .env explicitly
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# OVERRIDE DATABASE_URL FOR TESTS BEFORE ANY IMPORTS
test_db_url = os.getenv("TEST_DATABASE_URL")
if not test_db_url:
    raise RuntimeError("TEST_DATABASE_URL is not set!")
primary_db_url = os.getenv("DATABASE_URL")
if not primary_db_url:
    raise RuntimeError("DATABASE_URL is required to verify test database isolation")
if os.getenv("TEST_DATABASE_RESET_CONFIRM") != "1":
    raise RuntimeError("Set TEST_DATABASE_RESET_CONFIRM=1 only for an isolated disposable test database")
primary = make_url(primary_db_url)
test = make_url(test_db_url)
same_endpoint = (primary.host, primary.port, primary.database) == (test.host, test.port, test.database)
same_project_login = (primary.username, primary.database) == (test.username, test.database)
if same_endpoint or same_project_login:
    raise RuntimeError("TEST_DATABASE_URL may resolve to the primary database")
os.environ["DATABASE_URL"] = test_db_url

# Now we can safely import app modules
from main import app
from database import engine, get_db
from models.user import Base
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.testclient import TestClient
from fastapi_cache import FastAPICache
from fastapi_cache.backends.inmemory import InMemoryBackend

import pytest_asyncio

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_db():
    # Setup test cache
    FastAPICache.init(InMemoryBackend(), prefix="test-cache")
    
    # Run migrations on the TEST db
    import sqlalchemy
    from models.user import User, RoleEnum
    import uuid
    
    async with engine.begin() as conn:
        # Create types just like main.py
        await conn.execute(sqlalchemy.text("DO $$ BEGIN CREATE TYPE roleenum AS ENUM ('ADMIN', 'CASHIER_ORDERS', 'SENIOR_SALES', 'INVENTORY_CONTROLLER', 'SALES_ASSISTANT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"))
        await conn.execute(sqlalchemy.text("DO $$ BEGIN CREATE TYPE paymentmethodenum AS ENUM ('Cash', 'Bank Transfer', 'Check', 'Other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"))
        
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        
        # Insert a dummy admin user for foreign key constraints
        user_id = "00000000-0000-0000-0000-000000000001"
        await conn.execute(
            sqlalchemy.text("""
                INSERT INTO users (id, email, hashed_password, role, is_active)
                VALUES (:id, 'admin@test.com', 'dummy', 'ADMIN', true)
            """),
            {"id": user_id}
        )
    
    yield
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest_asyncio.fixture
async def db_session():
    async with AsyncSession(engine) as session:
        yield session

@pytest.fixture
def client():
    # We must not run app startup events because they execute against engine.begin() and might do weird things
    app.router.on_startup.clear()
    with TestClient(app) as client:
        yield client
