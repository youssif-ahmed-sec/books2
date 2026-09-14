import asyncio
from sqlalchemy.future import select
from database import AsyncSessionLocal
from models.user import User, RoleEnum
from core.security import hash_password

STAFF_MEMBERS = [
    {
        "email": "saud@bookstore.local",
        "role": RoleEnum.ADMIN,
    },
    {
        "email": "shady@bookstore.local",
        "role": RoleEnum.CASHIER_ORDERS,
    },
    {
        "email": "khaled@bookstore.local",
        "role": RoleEnum.SENIOR_SALES,
    },
    {
        "email": "ibrahim@bookstore.local",
        "role": RoleEnum.INVENTORY_CONTROLLER,
    },
    {
        "email": "abdelrahman@bookstore.local",
        "role": RoleEnum.SALES_ASSISTANT,
    }
]

async def seed_staff():
    default_password = hash_password("Password@123")
    
    async with AsyncSessionLocal() as db:
        for staff in STAFF_MEMBERS:
            # Check if user already exists
            query = select(User).where(User.email == staff["email"])
            result = await db.execute(query)
            existing_user = result.scalar_one_or_none()
            
            if existing_user:
                print(f"User {staff['email']} already exists. Updating role to {staff['role'].value}...")
                existing_user.role = staff["role"]
            else:
                print(f"Creating user {staff['email']} with role {staff['role'].value}...")
                new_user = User(
                    email=staff["email"],
                    hashed_password=default_password,
                    role=staff["role"]
                )
                db.add(new_user)
        
        await db.commit()
        print("✅ Staff seeded successfully!")

if __name__ == "__main__":
    asyncio.run(seed_staff())
