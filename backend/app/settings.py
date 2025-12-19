from pathlib import Path
from pydantic_settings import BaseSettings

# Get the backend directory (parent of app/)
BACKEND_DIR = Path(__file__).parent.parent

class Settings(BaseSettings):
    SUPABASE_DB_URL: str
    SUPABASE_URL: str = ""  # For realtime subscriptions in admin dashboard
    SUPABASE_ANON_KEY: str = ""  # For realtime subscriptions in admin dashboard
    WIKI_API_BASE: str = "https://en.wikipedia.org/w/api.php"
    CRAWLER_CONCURRENCY: int = 6
    CRAWLER_POLL_SECONDS: float = 1.0
    MAX_LINKS_PER_PAGE: int = 0  # 0 = unlimited (ALL links)
    ALLOW_NAMESPACES: str = "0"  # comma-separated
    USER_AGENT: str = "WikiGraphExplorer/0.1"
    MAX_DEGREE: int = 6  # Maximum degree of separation to crawl (0 = initial page, 1-6 = neighbor degrees)

    class Config:
        env_file = str(BACKEND_DIR / ".env")
        extra = "ignore"  # Ignore extra fields (like NEXT_PUBLIC_* vars that are for frontend)

settings = Settings()

