"""Exercise session deadlines and revocation against an isolated database."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from core.security import hash_password
from database import get_db
from main import app
from models.user import AuthSession, Base, RoleEnum, User


@compiles(JSONB, "sqlite")
def jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.mark.asyncio
async def test_idle_cashier_and_logout_sessions():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    password = hash_password("password12345")
    users = [User(id=uuid4(), username=name, full_name=name, role=role, hashed_password=password,
                  is_active=True, is_deleted=False)
             for name, role in [("admin1", RoleEnum.ADMIN), ("cashier1", RoleEnum.CASHIER_ORDERS)]]
    async with factory() as db:
        db.add_all(users)
        await db.commit()

    async def isolated_db():
        async with factory() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async def login(name):
                response = await client.post("/api/v1/auth/login", data={"username": name, "password": "password12345"})
                assert response.status_code == 200
                return {"Authorization": "Bearer " + response.json()["access_token"]}

            admin = await login("admin1")
            cashier = await login("cashier1")
            other_admin = await login("admin1")
            third_admin = await login("admin1")
            async with factory() as db:
                sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == users[0].id).order_by(AuthSession.created_at))).scalars().all()
                sessions[0].last_activity_at = datetime.now(timezone.utc) - timedelta(minutes=119)
                cashier_session = (await db.execute(select(AuthSession).where(AuthSession.user_id == users[1].id))).scalar_one()
                cashier_session.last_activity_at = datetime.now(timezone.utc) - timedelta(hours=3)
                await db.commit()
            assert (await client.get("/api/v1/auth/me", headers=admin)).status_code == 200
            async with factory() as db:
                sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == users[0].id).order_by(AuthSession.created_at))).scalars().all()
                assert sessions[0].last_activity_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc) - timedelta(minutes=118)
            assert (await client.get("/api/v1/auth/me", headers={**admin, "X-User-Activity": "1"})).status_code == 200
            assert (await client.get("/api/v1/auth/me", headers=admin)).status_code == 200
            assert (await client.get("/api/v1/auth/me", headers=cashier)).status_code == 200
            async with factory() as db:
                sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == users[0].id).order_by(AuthSession.created_at))).scalars().all()
                sessions[0].last_activity_at = datetime.now(timezone.utc) - timedelta(hours=2, seconds=1)
                cashier_session = (await db.execute(select(AuthSession).where(AuthSession.user_id == users[1].id))).scalar_one()
                cashier_session.created_at = datetime.now(timezone.utc) - timedelta(hours=24, seconds=1)
                await db.commit()
            assert (await client.get("/api/v1/auth/me", headers={**admin, "X-User-Activity": "1"})).status_code == 401
            assert (await client.get("/api/v1/auth/me", headers=admin)).status_code == 401
            assert (await client.get("/api/v1/auth/me", headers=cashier)).status_code == 401
            assert (await client.post("/api/v1/auth/logout", headers=other_admin)).status_code == 204
            assert (await client.get("/api/v1/auth/me", headers=other_admin)).status_code == 401
            assert (await client.get("/api/v1/auth/me", headers=third_admin)).status_code == 200
            async with factory() as db:
                user = await db.get(User, users[0].id)
                user.role = RoleEnum.CASHIER_ORDERS
                await db.commit()
            assert (await client.get("/api/v1/auth/me", headers=third_admin)).status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
