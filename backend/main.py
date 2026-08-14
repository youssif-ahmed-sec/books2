from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import os
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
| **admin** | Full access — register users, manage all data |
| **staff** | Products, Inventory, Orders |
| **user** | Read-only on public endpoints |

### Public Endpoints (no token needed)
- `GET /api/v1/products` — Browse products
- `POST /api/v1/auth/login` — Login
    """,
    version="1.0.0",
    swagger_ui_parameters={"persistAuthorization": True},
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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


@app.on_event("startup")
async def on_startup():
    from database import engine
    import models.user
    import models.product
    import models.inventory
    import models.order
    import models.customer
    from models.user import Base
    from sqlalchemy import text
    
    FastAPICache.init(InMemoryBackend(), prefix="fastapi-cache")

    async with engine.begin() as conn:

        # ── Step 1: Migrate users table (idempotent) ─────────────────────────
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS email VARCHAR UNIQUE,
            ADD COLUMN IF NOT EXISTS hashed_password VARCHAR;
        """))

        # ── Step 2: Migrate suppliers table — add extended fields ─────────────
        await conn.execute(text("""
            ALTER TABLE suppliers
            ADD COLUMN IF NOT EXISTS phone VARCHAR,
            ADD COLUMN IF NOT EXISTS email VARCHAR,
            ADD COLUMN IF NOT EXISTS address VARCHAR,
            ADD COLUMN IF NOT EXISTS tax_number VARCHAR,
            ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(18,2),
            ADD COLUMN IF NOT EXISTS payment_terms_days VARCHAR,
            ADD COLUMN IF NOT EXISTS notes VARCHAR,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
        """))

        # ── Step 3: Create supplier_payments table if not exists ──────────────
        await conn.execute(text("""
            DO $$ BEGIN
                CREATE TYPE paymentmethodenum AS ENUM ('Cash', 'Bank Transfer', 'Check', 'Other');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS supplier_payments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                supplier_id UUID NOT NULL REFERENCES suppliers(id),
                amount NUMERIC(18,2) NOT NULL,
                payment_method paymentmethodenum NOT NULL DEFAULT 'Cash',
                reference_number VARCHAR,
                notes VARCHAR,
                payment_date TIMESTAMPTZ DEFAULT now(),
                created_at TIMESTAMPTZ DEFAULT now()
            );
        """))

        # ── Step 2: Create the Postgres ENUM type for order status ────────────
        # Uses DO…EXCEPTION block so it's safe to re-run on every startup.
        await conn.execute(text("""
            DO $$ BEGIN
                CREATE TYPE orderstatusenum AS ENUM (
                    'Draft', 'Quotation', 'Approved', 'Ready', 'Delivered'
                );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
        """))

        # ── Step 3: Recreate orders tables with the new schema ────────────────
        # The orders/order_items tables were recently added and are empty.
        # We drop and recreate them to apply the new column layout
        # (Numeric precision, ENUM status, new OrderItem fields).
        # This is safe for a fresh deployment; in production with real data,
        # replace this block with a proper Alembic migration.
        await conn.execute(text("DROP TABLE IF EXISTS order_items CASCADE;"))
        await conn.execute(text("DROP TABLE IF EXISTS orders CASCADE;"))

        # Re-run create_all so SQLAlchemy creates the tables with the new schema
        await conn.run_sync(Base.metadata.create_all)

    print("✅ Database tables created/migrated successfully.")



@app.get("/health", tags=["Health"])
async def root():
    return {"message": "Welcome to Souod El Shafie Bookstore API", "docs": "/docs"}

# ── SPA / Static Files Serving ───────────────────────────────────────────────
static_dir = os.path.join(os.path.dirname(__file__), "static")

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
                txt_path = os.path.join(static_dir, path)
                if os.path.exists(txt_path):
                    return FileResponse(txt_path, media_type="text/plain")
                
                # Next.js 14 sometimes requests .__PAGE__.txt but stores it as /__PAGE__.txt
                if ".__PAGE__.txt" in path:
                    alt_path = path.replace(".__PAGE__.txt", "/__PAGE__.txt")
                    alt_txt_path = os.path.join(static_dir, alt_path)
                    if os.path.exists(alt_txt_path):
                        return FileResponse(alt_txt_path, media_type="text/plain")
            
            txt_path = os.path.join(static_dir, f"{path}.txt")
            if os.path.exists(txt_path):
                return FileResponse(txt_path, media_type="text/plain")
                
        # Serve the corresponding HTML file
        html_path = os.path.join(static_dir, f"{path}.html")
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
        if os.path.exists(html_path):
            return FileResponse(html_path, headers=headers)
        
        # Fallback to 404.html if it exists, otherwise index.html
        not_found_path = os.path.join(static_dir, "404.html")
        if os.path.exists(not_found_path):
            return FileResponse(not_found_path, status_code=404, headers=headers)
            
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path, headers=headers)
            
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
