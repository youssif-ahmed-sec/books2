import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from uuid import uuid4

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql://postgres:postgres@localhost:54322/postgres"

# Ensure we use sync pg driver
if DATABASE_URL.startswith("postgresql+asyncpg://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
elif DATABASE_URL.startswith("postgres+asyncpg://"):
    DATABASE_URL = DATABASE_URL.replace("postgres+asyncpg://", "postgresql://", 1)
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Import models
from models.product import Category, Product, ProductUnit, ProductPrice, PriceLevelEnum
from models.inventory import Warehouse

def seed_data():
    engine = create_engine(DATABASE_URL, echo=True)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # Seed Categories
        cat1 = Category(id=uuid4(), name_en="Electronics", name_ar="إلكترونيات")
        cat2 = Category(id=uuid4(), name_en="Books", name_ar="كتب")
        cat3 = Category(id=uuid4(), name_en="Stationery", name_ar="قرطاسية")
        
        session.add_all([cat1, cat2, cat3])
        
        # Seed Warehouses
        wh1 = Warehouse(id=uuid4(), name="Main Warehouse - المستودع الرئيسي", location="Riyadh")
        wh2 = Warehouse(id=uuid4(), name="Store 1 - المعرض الأول", location="Jeddah")
        
        session.add_all([wh1, wh2])
        
        # Seed Products
        # Product 1: Pen
        p1 = Product(
            id=uuid4(),
            sku="PEN-001",
            barcode="1234567890123",
            name_en="Blue Pen",
            name_ar="قلم أزرق",
            category_id=cat3.id,
            base_unit="Piece",
            cost=1.5,
            tax_rate=15,
            min_stock_level=100
        )
        session.add(p1)
        
        # Units and prices for P1
        p1_unit_piece = ProductUnit(id=uuid4(), product_id=p1.id, unit_name="Piece", conversion_factor=1, barcode="1234567890123")
        p1_unit_box = ProductUnit(id=uuid4(), product_id=p1.id, unit_name="Box (12)", conversion_factor=12, barcode="1234567890124")
        session.add_all([p1_unit_piece, p1_unit_box])
        session.flush() # Flush to db so prices can reference units
        
        # Prices for P1
        session.add(ProductPrice(product_id=p1.id, unit_id=p1_unit_piece.id, price_level=PriceLevelEnum.RETAIL, price=3.0))
        session.add(ProductPrice(product_id=p1.id, unit_id=p1_unit_piece.id, price_level=PriceLevelEnum.WHOLESALE, price=2.5))
        session.add(ProductPrice(product_id=p1.id, unit_id=p1_unit_box.id, price_level=PriceLevelEnum.RETAIL, price=30.0))
        session.add(ProductPrice(product_id=p1.id, unit_id=p1_unit_box.id, price_level=PriceLevelEnum.WHOLESALE, price=25.0))
        
        # Product 2: Notebook
        p2 = Product(
            id=uuid4(),
            sku="NB-A4-01",
            barcode="9876543210987",
            name_en="A4 Notebook",
            name_ar="دفتر مقاس A4",
            category_id=cat3.id,
            base_unit="Piece",
            cost=5.0,
            tax_rate=15,
            min_stock_level=50
        )
        session.add(p2)
        
        p2_unit_piece = ProductUnit(id=uuid4(), product_id=p2.id, unit_name="Piece", conversion_factor=1)
        p2_unit_pack = ProductUnit(id=uuid4(), product_id=p2.id, unit_name="Pack (5)", conversion_factor=5)
        session.add_all([p2_unit_piece, p2_unit_pack])
        session.flush()
        
        session.add(ProductPrice(product_id=p2.id, unit_id=p2_unit_piece.id, price_level=PriceLevelEnum.RETAIL, price=10.0))
        session.add(ProductPrice(product_id=p2.id, unit_id=p2_unit_piece.id, price_level=PriceLevelEnum.VIP, price=8.0))
        session.add(ProductPrice(product_id=p2.id, unit_id=p2_unit_pack.id, price_level=PriceLevelEnum.RETAIL, price=45.0))
        session.add(ProductPrice(product_id=p2.id, unit_id=p2_unit_pack.id, price_level=PriceLevelEnum.VIP, price=35.0))
        
        # Product 3: Novel
        p3 = Product(
            id=uuid4(),
            sku="BK-NV-001",
            name_en="The Great Gatsby",
            name_ar="غاتسبي العظيم",
            category_id=cat2.id,
            base_unit="Piece",
            cost=20.0,
            tax_rate=0,
            min_stock_level=10
        )
        session.add(p3)
        
        p3_unit = ProductUnit(id=uuid4(), product_id=p3.id, unit_name="Piece", conversion_factor=1)
        session.add(p3_unit)
        session.flush()
        session.add(ProductPrice(product_id=p3.id, unit_id=p3_unit.id, price_level=PriceLevelEnum.RETAIL, price=45.0))
        
        # Seed Inventory Balances
        from models.inventory import InventoryBalance
        bal1 = InventoryBalance(product_id=p1.id, warehouse_id=wh1.id, current_stock=250)
        bal2 = InventoryBalance(product_id=p1.id, warehouse_id=wh2.id, current_stock=100)
        bal3 = InventoryBalance(product_id=p2.id, warehouse_id=wh1.id, current_stock=500)
        bal4 = InventoryBalance(product_id=p3.id, warehouse_id=wh1.id, current_stock=50)
        
        session.add_all([bal1, bal2, bal3, bal4])
        
        session.commit()
        print("Successfully seeded categories, warehouses, products, and inventory balances.")
    except Exception as e:
        session.rollback()
        print(f"Error seeding database: {e}")
    finally:
        session.close()

if __name__ == "__main__":
    seed_data()
