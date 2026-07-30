import asyncio
from supabase import create_client, Client
import uuid
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def create_admin():
    email = "admin@saudelshafie.com"
    password = "password123"
    
    print(f"Attempting to create admin user: {email}...")
    try:
        # Create user via Supabase Auth Admin API (bypasses email confirmation)
        user = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "role": "Admin",
                "name": "System Admin"
            }
        })
        print(f"Successfully created user with ID: {user.user.id}")
        
    except Exception as e:
        if "User already registered" in str(e):
            print("User already exists!")
        else:
            print(f"Error creating user: {e}")

if __name__ == "__main__":
    create_admin()
