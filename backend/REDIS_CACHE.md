# Redis reference cache

The API caches only categories, subcategories, brands, and global units. Successful
changes to these lists invalidate their Redis entries immediately after the database
commit. Prices, products, balances, movements, financial data, and role-dependent
responses are read from the database. Browser/API responses retain `no-store`.

## Local Windows setup (PowerShell, Docker Desktop)

Run Redis bound to this computer only. Its data is disposable; the database remains
the source of truth.

```powershell
docker run -d --name books2-redis --restart unless-stopped -p 127.0.0.1:6379:6379 redis:7-alpine redis-server --save "" --appendonly no --maxmemory 256mb --maxmemory-policy noeviction
docker exec books2-redis redis-cli ping
```

The second command should print `PONG`. If the container already exists, use
`docker start books2-redis` instead of `docker run`.

Install the Redis client in the existing Python environment (it is also in
`backend/requirements.txt` for fresh installs), then set the URL in the same
terminal that starts the API:

```powershell
.\.venv\Scripts\python.exe -m ensurepip --upgrade
.\.venv\Scripts\python.exe -m pip install "redis>=5,<7"
$env:REDIS_URL = "redis://127.0.0.1:6379/0"
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Restart the API after setting `REDIS_URL`. No URL, a missing Redis Python package,
or an unreachable Redis server does not prevent API startup: reference reads use the
database. If Redis becomes unreachable later, reads continue from the database and
the API retries Redis periodically. After reconnecting, that API process clears its
reference entries before using them. Run the local Redis container without
persistence as shown above so an outage/restart cannot revive stale entries.

Changing these tables outside the API bypasses invalidation. After a manual database
edit, clear only the reference cache keys before serving traffic:

```powershell
docker exec books2-redis redis-cli --scan --pattern 'books2:ref:*'
```

Inspect the listed keys, then restart the disposable Redis container to clear them.
Do not run `FLUSHALL` on a Redis server shared with other applications.
