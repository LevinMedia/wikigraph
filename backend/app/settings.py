from pathlib import Path
from pydantic_settings import BaseSettings

# Get the backend directory (parent of app/)
BACKEND_DIR = Path(__file__).parent.parent

class Settings(BaseSettings):
    SUPABASE_DB_URL: str
    WIKI_API_BASE: str = "https://en.wikipedia.org/w/api.php"
    CRAWLER_CONCURRENCY: int = 6
    CRAWLER_POLL_SECONDS: float = 1.0
    MAX_LINKS_PER_PAGE: int = 0  # 0 = unlimited (ALL links)
    ALLOW_NAMESPACES: str = "0"  # comma-separated
    USER_AGENT: str = "WikiGraphExplorer/0.1"

    class Config:
        env_file = str(BACKEND_DIR / ".env")

settings = Settings()

