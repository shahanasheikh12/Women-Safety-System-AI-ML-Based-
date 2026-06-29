import os
from dotenv import load_dotenv

# Load environment variables from .env file for local development
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL:
    raise ValueError("[config] SUPABASE_URL environment variable is not set")

if not SUPABASE_SERVICE_KEY:
    raise ValueError("[config] SUPABASE_SERVICE_KEY environment variable is not set")
