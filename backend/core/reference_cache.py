"""Redis cache for small, role-independent reference lists.

Inventory, prices, and permission-dependent responses must not use this cache.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

try:
    from redis.asyncio import Redis
    from redis.exceptions import RedisError
except ImportError:  # Keep the application usable until Redis support is installed.
    Redis = None  # type: ignore[assignment,misc]

    class RedisError(Exception):
        pass


logger = logging.getLogger(__name__)
_client: Redis | None = None
_faulted = False
_available = False
_retry_at = 0.0
_names = ("categories", "subcategories", "brands", "global_units")


async def open_reference_cache(url: str | None) -> None:
    global _client, _faulted, _available, _retry_at
    if not url:
        logger.info("Reference cache disabled: REDIS_URL is not set")
        return
    if Redis is None:
        logger.warning("Redis client package is not installed; reference reads will use the database")
        return
    client = None
    try:
        client = Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
        await client.ping()
    except (RedisError, OSError, ValueError):
        _client = client
        _available = False
        _faulted = True
        _retry_at = time.monotonic() + 10
        logger.warning("Redis unavailable at startup; reference reads will use the database")
        return
    _client = client
    _available = True
    _faulted = False


async def close_reference_cache() -> None:
    global _client, _available
    if _client is not None:
        await _client.aclose()
        _client = None
    _available = False


async def _ready(client: Redis) -> bool:
    global _available, _retry_at, _faulted
    if _available:
        return True
    if time.monotonic() < _retry_at:
        return False
    try:
        await client.ping()
    except (RedisError, OSError):
        _retry_at = time.monotonic() + 10
        return False
    _available = True
    _faulted = True  # Discard any entries that survived an outage.
    return True


def _keys(name: str) -> tuple[str, str]:
    if name not in _names:
        raise ValueError(f"Unknown reference cache: {name}")
    return f"books2:ref:v1:{name}:version", f"books2:ref:v1:{name}:data"


async def _recover_if_needed(client: Redis) -> None:
    global _faulted
    if not _faulted:
        return
    # A missed invalidation during a Redis outage must not survive recovery.
    async with client.pipeline(transaction=True) as pipeline:
        for name in _names:
            pipeline.delete(_keys(name)[1])
        await pipeline.execute()
    _faulted = False


async def cached_reference(name: str, load: Callable[[], Awaitable[list[dict[str, Any]]]]) -> list[dict[str, Any]]:
    client = _client
    if client is None or not await _ready(client):
        return await load()
    version_key, data_key = _keys(name)
    try:
        await _recover_if_needed(client)
        version, raw = await client.mget(version_key, data_key)
        generation = (version or b"0").decode()
        if raw is not None:
            entry = json.loads(raw)
            if entry["generation"] == generation:
                return entry["value"]
    except (RedisError, ValueError, KeyError, TypeError) as exc:
        if isinstance(exc, RedisError):
            _mark_unavailable()
        logger.warning("Reference cache read failed for %s; using database", name, exc_info=True)
        return await load()

    value = await load()
    try:
        # A writer can invalidate while the database query runs. Never publish
        # a result loaded under an older generation after that invalidation.
        await client.eval(
            "if (redis.call('GET', KEYS[1]) or '0') == ARGV[1] then "
            "redis.call('SET', KEYS[2], ARGV[2], 'EX', 86400); return 1 else return 0 end",
            2, version_key, data_key, generation,
            json.dumps({"generation": generation, "value": value}),
        )
        current_version = await client.get(version_key)
        if (current_version or b"0").decode() != generation:
            return await load()
    except RedisError:
        _mark_unavailable()
        logger.warning("Reference cache write failed for %s; using database", name, exc_info=True)
    return value


async def invalidate_reference(name: str) -> None:
    global _faulted
    client = _client
    if client is None or not await _ready(client):
        _faulted = True
        return
    version_key, data_key = _keys(name)
    try:
        async with client.pipeline(transaction=True) as pipeline:
            pipeline.incr(version_key)
            pipeline.delete(data_key)
            await pipeline.execute()
    except RedisError:
        _mark_unavailable()
        logger.error("Reference cache invalidation failed for %s", name, exc_info=True)


def _mark_unavailable() -> None:
    global _available, _retry_at, _faulted
    _available = False
    _faulted = True
    _retry_at = time.monotonic() + 10
