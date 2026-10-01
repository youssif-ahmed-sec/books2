from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import os
from pathlib import Path
from fastapi_cache import FastAPICache
from fastapi_cache.backends.inmemory import InMemoryBackend

from api.v1.products import router as products_router
from api.v1.inventory import router as inventory_router
from api.v1.auth import router as auth_router
from api.v1.orders import router as orders_router
from api.v1.global_units import router as global_units_router
from api.v1.upload import router as upload_router
from api.v1.suppliers import router as suppliers_router
from api.v1.customers import router as customers_router
from api.v1.pos import router as pos_router
from api.v1.financials import router as financials_router
from api.v1.webhooks import router as webhooks_router
from api.v1.dashboards import router as dashboards_router
from api.v1.reports import router as reports_router
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize cache
    FastAPICache.init(InMemoryBackend(), prefix="fastapi-cache")
    print("✅ Cache initialized.")
    yield
    # Cleanup on shutdown (if any)
    print("🛑 Shutting down.")
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
| **INVENTORY_CONTROLLER** | Products, categories, brands, suppliers, and stock |
| **CASHIER_ORDERS** | POS and orders |
| **SENIOR_SALES** | Sales reports |
| **SALES_ASSISTANT** | Customer records and product lookup |

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

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router,      prefix="/api/v1")
app.include_router(products_router,  prefix="/api/v1")
app.include_router(inventory_router, prefix="/api/v1")
app.include_router(orders_router,    prefix="/api/v1")
app.include_router(global_units_router, prefix="/api/v1")
app.include_router(upload_router,    prefix="/api/v1")
app.include_router(suppliers_router, prefix="/api/v1")
app.include_router(customers_router, prefix="/api/v1")
app.include_router(pos_router,       prefix="/api/v1")
app.include_router(financials_router, prefix="/api/v1")
app.include_router(webhooks_router,  prefix="/api/v1")
app.include_router(dashboards_router, prefix="/api/v1")
app.include_router(reports_router,    prefix="/api/v1")


@app.get("/health", tags=["Health"])
async def root():
    return {"message": "Welcome to Souod El Shafie Bookstore API", "docs": "/docs"}

# ── SPA / Static Files Serving ───────────────────────────────────────────────
static_dir = os.path.join(os.path.dirname(__file__), "static")


def safe_static_file(relative_path: str) -> Path | None:
    static_root = Path(static_dir).resolve()
    candidate = (static_root / relative_path).resolve()
    if candidate.is_relative_to(static_root) and candidate.is_file():
        return candidate
    return None

if os.path.exists(static_dir):
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
