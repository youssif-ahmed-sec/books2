import os
from dotenv import load_dotenv
from sqlalchemy import create_engine

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql://postgres:postgres@localhost:54322/postgres"

# Import models to register them with Base
import models.user
import models.product
import models.inventory

# All models share the same Base from models.user
from models.user import Base

def init_db():
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(engine)
    print("Database tables created successfully.")

if __name__ == "__main__":
    init_db()
