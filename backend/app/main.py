import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

from .graph_api import router as graph_router
from .admin_api import router as admin_router
from .crawler import crawler_loop

app = FastAPI(title="Wiki Graph Crawler")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph_router)
app.include_router(admin_router)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

from typing import Optional

_stop_event = asyncio.Event()
_crawler_task: Optional[asyncio.Task] = None

@app.on_event("startup")
async def startup():
    import logging
    logger = logging.getLogger(__name__)
    logger.info("Starting crawler loop...")
    global _crawler_task
    try:
        _crawler_task = asyncio.create_task(crawler_loop(_stop_event))
        logger.info("Crawler task created")
    except Exception as e:
        logger.error(f"Failed to start crawler loop: {e}", exc_info=True)
        raise

@app.on_event("shutdown")
async def shutdown():
    _stop_event.set()
    if _crawler_task:
        _crawler_task.cancel()

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    from .settings import settings
    return templates.TemplateResponse("index.html", {
        "request": request,
        "supabase_url": settings.SUPABASE_URL,
        "supabase_anon_key": settings.SUPABASE_ANON_KEY,
    })

