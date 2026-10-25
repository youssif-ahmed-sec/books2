import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from api.v1.audit import audit_history
from api.v1.inventory import get_inventory_transactions
from api.v1.products import get_product_history
from services import audit_retention
from uuid import uuid4


def test_audit_cleanup_only_deletes_expired_audit_rows(monkeypatch):
    cutoff = datetime(2026, 7, 28, tzinfo=timezone.utc)

    class Session:
        committed = False
        statement = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            self.statement = statement
            return SimpleNamespace(rowcount=2)

        async def commit(self):
            self.committed = True

    session = Session()
    monkeypatch.setattr(audit_retention, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(audit_retention, "audit_cutoff", lambda: cutoff)

    assert asyncio.run(audit_retention.purge_expired_audit_logs()) == 2
    compiled = session.statement.compile(dialect=postgresql.dialect())
    sql = str(compiled)
    assert session.committed
    assert sql.startswith("DELETE FROM audit_logs")
    assert "audit_logs.created_at <" in sql
    assert cutoff in compiled.params.values()
    assert audit_retention.BATCH_SIZE in compiled.params.values()
    assert "inventory_transactions" not in sql


def test_history_endpoints_hide_expired_audit_rows_and_bound_product_movements():
    product_id = uuid4()

    class Result:
        def scalar_one_or_none(self):
            return product_id

        def scalar(self):
            return 0

        def scalars(self):
            return self

        def all(self):
            return []

    class Db:
        def __init__(self):
            self.statements = []

        async def execute(self, statement):
            self.statements.append(statement)
            return Result()

    audit_db = Db()
    assert asyncio.run(audit_history(limit=100, offset=0, search=None, db=audit_db,
                                     _user=SimpleNamespace())) == []
    assert "audit_logs.created_at >=" in str(audit_db.statements[0])

    product_db = Db()
    assert asyncio.run(get_product_history(product_id=product_id, limit=100, db=product_db,
                                           _user=SimpleNamespace())) == []
    assert "audit_logs.created_at >=" in str(product_db.statements[1])

    inventory_db = Db()
    result = asyncio.run(get_inventory_transactions(page=1, limit=100, product_id=product_id,
                                                     recent_days=90, db=inventory_db,
                                                     current_user=SimpleNamespace()))
    assert result == {"data": [], "total": 0}
    assert len(inventory_db.statements) == 2
    assert all("inventory_transactions.created_at >=" in str(statement)
               for statement in inventory_db.statements)
