"""SQLite-only DDL compatibility for PostgreSQL-backed model tests."""
import re

from sqlalchemy import DefaultClause, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.schema import CreateColumn
from sqlalchemy.sql.functions import next_value


@event.listens_for(Engine, "connect")
def sqlite_postgres_functions(connection, _record):
    if not type(connection).__module__.startswith("sqlalchemy.dialects.sqlite"):
        return
    connection.create_function("btrim", 1, lambda value: value.strip() if value is not None else None)
    def regexp_replace(value, pattern, replacement, flags):
        if value is None:
            return None
        if pattern != "[[:space:]]+" or flags != "g":
            raise ValueError("Unsupported PostgreSQL regexp in SQLite test")
        return re.sub(r"\s+", replacement, value)
    connection.create_function("regexp_replace", 4, regexp_replace)
    connection.create_function("greatest", -1, lambda *values: max((value for value in values if value is not None), default=None))


@compiles(CreateColumn, "sqlite")
def sqlite_sequence_default(element, compiler, **kwargs):
    column = element.element
    original = column.server_default
    if original is None or not (isinstance(original.arg, next_value) or "nextval(" in str(original.arg)):
        return compiler.visit_create_column(element, **kwargs)
    # Random row identifiers are used only for SQLite tests; production keeps
    # its PostgreSQL sequence. Restore metadata immediately after rendering.
    column.server_default = DefaultClause(text("(abs(random()))"))
    try:
        return compiler.visit_create_column(element, **kwargs)
    finally:
        column.server_default = original
