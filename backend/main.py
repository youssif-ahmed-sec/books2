from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from api.v1.products import router as products_router
from api.v1.inventory import router as inventory_router
from api.v1.auth import router as auth_router

app = FastAPI(
    title="Souod El Shafie Bookstore API",
    description="""
## 📚 Souod El Shafie Bookstore API

### Authentication
1. Use **POST /api/v1/auth/login** with your email & password
2. Copy the `access_token` from the response
3. Click the 🔒 **Authorize** button at the top and enter: `Bearer <your_token>`
4. All protected endpoints will now work automatically
    """,
    version="1.0.0",
    swagger_ui_parameters={"persistAuthorization": True},
)

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(products_router, prefix="/api/v1")
app.include_router(inventory_router, prefix="/api/v1")


@app.on_event("startup")
async def on_startup():
    from database import engine
    import models.user
    import models.product
    import models.inventory
    from models.user import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables created successfully on startup.")


@app.get("/", tags=["Health"])
async def root():
    return {"message": "Welcome to Souod El Shafie Bookstore API", "docs": "/docs"}
