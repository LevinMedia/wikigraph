import asyncio
import asyncpg
from app.settings import settings
from urllib.parse import urlparse

async def test_connection():
    try:
        url = settings.SUPABASE_DB_URL
        parsed = urlparse(url)
        print(f"Connecting to: {parsed.hostname}:{parsed.port}")
        print(f"Username: {parsed.username}")
        print(f"Database: {parsed.path[1:]}")
        
        # Try with explicit SSL
        pool = await asyncpg.create_pool(
            dsn=url,
            min_size=1,
            max_size=1,
            timeout=10,
            ssl='require'
        )
        print("✓ Connection successful!")
        await pool.close()
    except Exception as e:
        print(f"✗ Connection failed: {e}")
        print(f"Error type: {type(e).__name__}")

if __name__ == "__main__":
    asyncio.run(test_connection())

