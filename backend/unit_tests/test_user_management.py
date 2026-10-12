"""Authorization and identifier regression checks without touching a database."""

from types import SimpleNamespace
from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from api.v1.auth import SimpleLoginForm, delete_user, login, register_user, set_user_status, update_user
from core.security import hash_password, create_access_token
from core.dependencies import get_current_user
from main import app
from models.user import AuditLog, RoleEnum, User
from schemas.auth import UserRegisterRequest, UserStatusRequest, UserUpdateRequest


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(_element, _compiler, **_kwargs):
    return "JSON"


def result(user=None, count=None):
    return SimpleNamespace(scalar_one_or_none=lambda: user, scalar_one=lambda: count, scalars=lambda: SimpleNamespace(all=lambda: [user] if count == 1 else [user, staff()]))


def session(*responses):
    db = SimpleNamespace(
        execute=AsyncMock(side_effect=list(responses)),
        add=lambda _: None,
        flush=AsyncMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
        rollback=AsyncMock(),
    )
    return db


def admin():
    return User(id=uuid4(), email="admin@example.com", role=RoleEnum.ADMIN, is_active=True, is_deleted=False)


def staff():
    return User(id=uuid4(), email="staff@example.com", username="staff1", role=RoleEnum.SALES_ASSISTANT, is_active=True, is_deleted=False, created_at=datetime.now(timezone.utc))


def test_username_is_optional_and_normalized():
    request = UserRegisterRequest(email="staff@example.com", password="password12345", username="Staff_1")
    assert request.username == "staff_1"
    assert UserRegisterRequest(email="staff@example.com", password="password12345").username is None
    with pytest.raises(ValidationError):
        UserRegisterRequest(email="staff@example.com", password="password12345", username="bad@name")


@pytest.mark.asyncio
async def test_username_login_and_inactive_rejection():
    user = staff()
    user.hashed_password = hash_password("password12345")
    db = session(result(user))
    response = await login(SimpleLoginForm(username="STAFF1", password="password12345"), db)
    assert response.user.id == user.id
    assert response.access_token
    query = str(db.execute.call_args.args[0])
    assert "users.username" in query and "lower(users.email)" in query
    assert "users.is_active" in query and "users.is_deleted" in query
    db = session(result())
    with pytest.raises(HTTPException) as error:
        await login(SimpleLoginForm(username="STAFF1", password="password12345"), db)
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_revoked_user_token_is_rejected():
    user = staff()
    db = session(result())
    with pytest.raises(HTTPException) as error:
        await get_current_user(create_access_token(subject=str(user.id)), db)
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_duplicate_username_registration_conflicts():
    db = session(result(), result(staff()))
    with pytest.raises(HTTPException) as error:
        await register_user(UserRegisterRequest(email="new@example.com", username="staff1", password="password12345"), db, admin())
    assert error.value.status_code == 409
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_cannot_disable_or_delete_own_admin():
    current = admin()
    db = session(result(current))
    with pytest.raises(HTTPException) as error:
        await set_user_status(current.id, UserStatusRequest(is_active=False), db, current)
    assert error.value.status_code == 409
    db = session(result(current))
    with pytest.raises(HTTPException) as error:
        await delete_user(current.id, db, current)
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_last_active_admin_cannot_lose_role():
    current = admin()
    other = admin()
    db = session(result(other), result(count=1))
    with pytest.raises(HTTPException) as error:
        await update_user(other.id, UserUpdateRequest(role=RoleEnum.SALES_ASSISTANT), db, current)
    assert error.value.status_code == 409
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_email_update_rejects_case_insensitive_duplicate():
    current = admin()
    user = staff()
    db = session(result(user), result(uuid4()))
    with pytest.raises(HTTPException) as error:
        await update_user(user.id, UserUpdateRequest(email="ADMIN@EXAMPLE.COM"), db, current)
    assert error.value.status_code == 409
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_deactivate_staff_and_soft_delete():
    current = admin()
    user = staff()
    db = session(result(user))
    changed = await set_user_status(user.id, UserStatusRequest(is_active=False), db, current)
    assert changed.is_active is False
    db.commit.assert_awaited_once()
    db = session(result(user))
    await delete_user(user.id, db, current)
    assert user.is_deleted is True
    assert user.is_active is False
    db.commit.assert_awaited_once()


@pytest.mark.parametrize("method,path", [
    ("get", "/api/v1/auth/users"),
    ("patch", "/api/v1/auth/users/00000000-0000-0000-0000-000000000001"),
    ("patch", "/api/v1/auth/users/00000000-0000-0000-0000-000000000001/status"),
    ("delete", "/api/v1/auth/users/00000000-0000-0000-0000-000000000001"),
])
def test_staff_cannot_manage_users(method, path):
    app.dependency_overrides[get_current_user] = staff
    try:
        with TestClient(app) as client:
            response = client.request(method.upper(), path, json={} if method == "patch" else None)
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_user_lifecycle_persists_in_isolated_sqlite():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(User.__table__.create)
            await connection.run_sync(AuditLog.__table__.create)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as db:
            current = admin()
            db.add(current)
            await db.commit()
            created = await register_user(UserRegisterRequest(email="new@example.com", username="Worker_1", password="password12345"), db, current)
            assert created.username == "worker_1"
            logged_in = await login(SimpleLoginForm(username="WORKER_1", password="password12345"), db)
            assert logged_in.user.id == created.id
            updated = await update_user(created.id, UserUpdateRequest(email="other@example.com", username="Worker_2"), db, current)
            assert updated.username == "worker_2"
            disabled = await set_user_status(created.id, UserStatusRequest(is_active=False), db, current)
            assert disabled.is_active is False
            with pytest.raises(HTTPException) as error:
                await login(SimpleLoginForm(username="worker_2", password="password12345"), db)
            assert error.value.status_code == 401
            await delete_user(created.id, db, current)
            assert created.is_deleted is True
    finally:
        await engine.dispose()
