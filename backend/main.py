from fastapi import FastAPI, Request, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import asyncio
import os
from pathlib import Path
from core.reference_cache import open_reference_cache, close_reference_cache
from core.dashboard_events import dashboard_event_hub
from services.notification_retention import run_notification_retention
from services.audit_retention import run_audit_retention
from services.customer_due_alerts import run_customer_due_alerts

from api.v1.products import router as products_router
from api.v1.product_approvals import router as product_approvals_router
from api.v1.inventory import router as inventory_router
from api.v1.auth import router as auth_router
from api.v1.orders import router as orders_router
from api.v1.global_units import router as global_units_router
from api.v1.upload import router as upload_router
from api.v1.suppliers import router as suppliers_router
from api.v1.customers import router as customers_router
from api.v1.customer_accounts import router as customer_accounts_router
from api.v1.pos import router as pos_router
from api.v1.financials import router as financials_router
from api.v1.webhooks import router as webhooks_router
from api.v1.dashboards import router as dashboards_router
from api.v1.reports import router as reports_router
from api.v1.purchases import router as purchases_router
from api.v1.inventory_ops import router as inventory_ops_router
from api.v1.returns import router as returns_router
from api.v1.cash_register import router as cash_register_router
from api.v1.audit import router as audit_router
from api.v1.warehouse_reports import router as warehouse_reports_router
from api.v1.notifications import router as notifications_router
from api.v1.offers import router as offers_router
from api.v1.purchase_documents import router as purchase_documents_router
from core.feature_flags import warehouse_only_mode
from contextlib import asynccontextmanager, suppress


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_reference_cache(os.getenv("REDIS_URL"))
    retention_task = asyncio.create_task(run_notification_retention())
    audit_retention_task = asyncio.create_task(run_audit_retention())
    due_alert_task = asyncio.create_task(run_customer_due_alerts())
    try:
        yield
    finally:
        retention_task.cancel()
        audit_retention_task.cancel()
        due_alert_task.cancel()
        with suppress(asyncio.CancelledError):
            await retention_task
        with suppress(asyncio.CancelledError):
            await audit_retention_task
        with suppress(asyncio.CancelledError):
            await due_alert_task
        await dashboard_event_hub.close()
        await close_reference_cache()
app = FastAPI(
    title="Souod El Shafie Bookstore API",
    description="""
## 📚 Souod El Shafie Bookstore API

### Authentication
1. Use **POST /api/v1/auth/login** with your email & password
2. Copy the `access_token` from the response
3. Click the 🔒 **Authorize** button at the top and enter: `Bearer <your_token>`
4. All protected endpoints will now work automatically

### Access Levels
| Role | Access |
|------|--------|
| **ADMIN** | Users, financial records, inventory, sales, and reports |
| **INVENTORY_CONTROLLER** | Products, categories, brands, offer creation, and stock |
| **CASHIER_ORDERS** | Sales, orders, and order preparation |

### Public Endpoints (no token needed)
- `POST /api/v1/auth/login` — Login
    """,
    version="1.0.0",
    swagger_ui_parameters={"persistAuthorization": True},
    lifespan=lifespan,
)

# ── Security Headers Middleware ──────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Cache-Control"] = "no-store"
    return response

# ── CORS ─────────────────────────────────────────────────────────────────────
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("BACKEND_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router,      prefix="/api/v1")
app.include_router(products_router,  prefix="/api/v1")
app.include_router(product_approvals_router, prefix="/api/v1")
app.include_router(inventory_router, prefix="/api/v1")
app.include_router(global_units_router, prefix="/api/v1")
app.include_router(upload_router,    prefix="/api/v1")
app.include_router(suppliers_router, prefix="/api/v1")
app.include_router(purchases_router,  prefix="/api/v1")
app.include_router(inventory_ops_router, prefix="/api/v1")
app.include_router(audit_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(offers_router, prefix="/api/v1")
app.include_router(purchase_documents_router, prefix="/api/v1")

# Temporary warehouse handoff mode. The full routers remain available in source
# and can be restored by an explicit configuration change and frontend rebuild.
WAREHOUSE_ONLY_MODE = warehouse_only_mode()
if WAREHOUSE_ONLY_MODE:
    app.include_router(warehouse_reports_router, prefix="/api/v1")
else:
    app.include_router(orders_router, prefix="/api/v1")
    app.include_router(customers_router, prefix="/api/v1")
    app.include_router(customer_accounts_router, prefix="/api/v1")
    app.include_router(pos_router, prefix="/api/v1")
    app.include_router(financials_router, prefix="/api/v1")
    app.include_router(webhooks_router, prefix="/api/v1")
    app.include_router(dashboards_router, prefix="/api/v1")
    app.include_router(reports_router, prefix="/api/v1")
    app.include_router(returns_router, prefix="/api/v1")
    app.include_router(cash_register_router, prefix="/api/v1")


@app.get("/health", tags=["Health"])
async def root(response: Response, db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
        return {"message": "Welcome to Souod El Shafie Bookstore API", "status": "ok", "database": "connected", "docs": "/docs"}
    except Exception:
        response.status_code = 503
        return {"message": "Welcome to Souod El Shafie Bookstore API", "status": "degraded", "database": "unreachable", "docs": "/docs"}

# ── SPA / Static Files Serving ───────────────────────────────────────────────
def select_static_dir(*candidates: Path) -> Path | None:
    """Serve only a complete export, preferring the packaged build."""
    return next((path for path in candidates if (path / "index.html").is_file()), None)


backend_root = Path(__file__).resolve().parent
static_dir = select_static_dir(
    backend_root / "static",
    backend_root.parent / "frontend" / "out",
)


def safe_static_file(relative_path: str) -> Path | None:
    if static_dir is None:
        return None
    static_root = Path(static_dir).resolve()
    candidate = (static_root / relative_path).resolve()
    if candidate.is_relative_to(static_root) and candidate.is_file():
        return candidate
    return None

if static_dir is not None:
    # Serve Next.js static assets
    app.mount("/", StaticFiles(directory=static_dir, html=False), name="static")

    # Fallback for SPA Routing: Any 404 that is not an API request serves index.html
    @app.exception_handler(404)
    async def custom_404_handler(request: Request, exc):
        if request.url.path.startswith("/api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
            
        path = request.url.path.strip("/")
        if not path:
            path = "index"
            
        # Handle Next.js App Router RSC payload requests
        if request.headers.get("rsc") == "1" or path.endswith(".txt"):
            if path.endswith(".txt"):
                txt_path = safe_static_file(path)
                if txt_path:
                    return FileResponse(txt_path, media_type="text/plain")
                
                # Next.js 14 sometimes requests .__PAGE__.txt but stores it as /__PAGE__.txt
                if ".__PAGE__.txt" in path:
                    alt_path = path.replace(".__PAGE__.txt", "/__PAGE__.txt")
                    alt_txt_path = safe_static_file(alt_path)
                    if alt_txt_path:
                        return FileResponse(alt_txt_path, media_type="text/plain")

                # Nested static-export segments are stored as directories even
                # when the client requests their RSC name with dots.
                parent, _, filename = path.rpartition("/")
                segments = filename.removesuffix(".txt").split(".")
                if segments[0] == "__next" and len(segments) >= 3:
                    nested = "/".join((parent, ".".join(segments[:2]), *segments[2:])) + ".txt"
                    nested_txt_path = safe_static_file(nested)
                    if nested_txt_path:
                        return FileResponse(nested_txt_path, media_type="text/plain")
            
            txt_path = safe_static_file(f"{path}.txt")
            if txt_path:
                return FileResponse(txt_path, media_type="text/plain")
                
        # Serve the corresponding HTML file
        html_path = safe_static_file(f"{path}.html")
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
        if html_path:
            return FileResponse(html_path, headers=headers)
        
        # Fallback to 404.html if it exists, otherwise index.html
        not_found_path = safe_static_file("404.html")
        if not_found_path:
            return FileResponse(not_found_path, status_code=404, headers=headers)
            
        index_path = safe_static_file("index.html")
        if index_path:
            return FileResponse(index_path, headers=headers)
            
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
