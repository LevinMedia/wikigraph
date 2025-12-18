# Wiki Graph Crawler Backend

FastAPI backend for crawling Wikipedia pages and storing link relationships in Supabase.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Create `.env` file:
```env
SUPABASE_DB_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
WIKI_API_BASE=https://en.wikipedia.org/w/api.php
CRAWLER_CONCURRENCY=6
CRAWLER_POLL_SECONDS=1.0
MAX_LINKS_PER_PAGE=0
ALLOW_NAMESPACES=0
USER_AGENT=WikiGraphExplorer/0.1 (contact: you@example.com)
```

3. Run database migrations:
   - Go to Supabase SQL Editor
   - Run `scripts/create_tables.sql`

4. Start the server:
```bash
uvicorn app.main:app --reload
```

## API Endpoints

- `GET /` - Dashboard UI
- `GET /api/graph/ego?page_id={id}&limit_neighbors={n}` - Get ego graph
- `POST /api/admin/enqueue` - Enqueue a page for crawling
- `GET /api/admin/jobs` - Get crawl jobs status

## Deployment

The backend can be deployed to:
- Railway
- Render
- Fly.io
- Any Python hosting service

Make sure to set all environment variables in your hosting platform.

