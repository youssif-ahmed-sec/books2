"""One PostgreSQL listener per API process, shared by open admin dashboards."""

import asyncio

import asyncpg
from sqlalchemy.engine import make_url

from database import DATABASE_URL, connect_args


CHANNEL = "books2_dashboard_changed"
EXPECTED_TRIGGER_COUNT = 18


class DashboardEventHub:
    def __init__(self) -> None:
        self._connection: asyncpg.Connection | None = None
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._lock = asyncio.Lock()

    def _publish(self, event: str) -> None:
        for queue in tuple(self._subscribers):
            if event == "disconnected" and not queue.empty():
                queue.get_nowait()
            if queue.empty():
                queue.put_nowait(event)

    def _on_notification(self, _connection: asyncpg.Connection, _pid: int,
                         _channel: str, _payload: str) -> None:
        self._publish("changed")

    def _on_termination(self, connection: asyncpg.Connection) -> None:
        if self._connection is connection:
            self._connection = None
            self._publish("disconnected")

    async def subscribe(self) -> asyncio.Queue[str]:
        async with self._lock:
            if self._connection is None or self._connection.is_closed():
                url = make_url(DATABASE_URL)
                connection = await asyncpg.connect(
                    host=url.host, port=url.port or 5432, user=url.username,
                    password=url.password, database=url.database,
                    ssl=connect_args.get("ssl"), statement_cache_size=0, timeout=10,
                )
                try:
                    trigger_count = await connection.fetchval(
                        "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_dashboard_changed' AND NOT tgisinternal"
                    )
                    if trigger_count != EXPECTED_TRIGGER_COUNT:
                        raise RuntimeError("Dashboard event migration is not applied")
                    await connection.add_listener(CHANNEL, self._on_notification)
                    connection.add_termination_listener(self._on_termination)
                except BaseException:
                    await connection.close()
                    raise
                self._connection = connection
            queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1)
            self._subscribers.add(queue)
            return queue

    async def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        async with self._lock:
            self._subscribers.discard(queue)
            if not self._subscribers and self._connection is not None:
                connection, self._connection = self._connection, None
                await connection.close()

    async def close(self) -> None:
        async with self._lock:
            self._publish("disconnected")
            self._subscribers.clear()
            if self._connection is not None:
                connection, self._connection = self._connection, None
                await connection.close()


dashboard_event_hub = DashboardEventHub()
