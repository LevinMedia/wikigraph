from typing import Optional
import asyncpg
from urllib.parse import urlparse
from .settings import settings

_pool: Optional[asyncpg.Pool] = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        # Parse connection string - pooler requires explicit parameters
        from urllib.parse import urlparse
        import ssl
        parsed = urlparse(settings.SUPABASE_DB_URL)
        # Create SSL context that doesn't verify certificates (for pooler)
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        _pool = await asyncpg.create_pool(
            host=parsed.hostname,
            port=parsed.port or 5432,
            user=parsed.username,
            password=parsed.password,
            database=parsed.path.lstrip('/').split('?')[0] or 'postgres',
            min_size=1,
            max_size=10,
            ssl=ssl_context
        )
    return _pool

