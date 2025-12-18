import asyncio
import asyncpg
from app.settings import settings

async def test():
    dsn = settings.SUPABASE_DB_URL
    print(f"Testing connection with DSN: {dsn.split('@')[0]}@[HIDDEN]")
    
    # Try 1: DSN as-is
    try:
        conn = await asyncpg.connect(dsn)
        print("✓ Connected with DSN as-is!")
        await conn.close()
        return
    except Exception as e:
        print(f"✗ DSN as-is failed: {type(e).__name__}: {e}")
    
    # Try 2: DSN without query params
    try:
        dsn_no_params = dsn.split('?')[0]
        conn = await asyncpg.connect(dsn_no_params, ssl='require')
        print("✓ Connected with DSN without params + ssl='require'!")
        await conn.close()
        return
    except Exception as e:
        print(f"✗ DSN without params failed: {type(e).__name__}: {e}")
    
    # Try 3: Parsed parameters
    from urllib.parse import urlparse
    parsed = urlparse(dsn)
    try:
        conn = await asyncpg.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            user=parsed.username,
            password=parsed.password,
            database=parsed.path.lstrip('/').split('?')[0] or 'postgres',
            ssl='require'
        )
        print("✓ Connected with parsed parameters!")
        await conn.close()
        return
    except Exception as e:
        print(f"✗ Parsed parameters failed: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test())

