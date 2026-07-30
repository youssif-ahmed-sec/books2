from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.v1.products import router as products_router
from api.v1.inventory import router as inventory_router
from api.v1.auth import router as auth_router

app = FastAPI(title="Souod El Shafie Bookstore API")

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For development, allow all origins.cd
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(products_router, prefix="/api/v1")
app.include_router(inventory_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")

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

@app.get("/")
async def root():
    return {"message": "Welcome to Souod El Shafie Bookstore API"}
