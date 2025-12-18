from fastapi import APIRouter, HTTPException
from .db import get_pool
from .models import EnqueueRequest
from .wiki_api import resolve_title
from .crawler import upsert_page, enqueue_by_page_id

router = APIRouter(prefix="/api/admin", tags=["admin"])

@router.post("/enqueue")
async def enqueue(req: EnqueueRequest):
    try:
        pool = await get_pool()
        info = await resolve_title(req.title)
        await upsert_page(pool, info["page_id"], info["title"], info["namespace"], info["is_redirect"])
        
        # Store auto_crawl flag in last_cursor
        import json
        cursor_data = {"link_direction": req.link_direction}
        if req.auto_crawl_neighbors:
            cursor_data["auto_crawl"] = "true"
        
        await pool.execute(
            """
            insert into page_fetch (page_id, status, requested_by, priority, last_cursor)
            values ($1, 'queued', $2, $3, $4::jsonb)
            on conflict (page_id) do update set
              -- Always allow re-queuing if status is 'done' or 'error' (user wants to re-crawl)
              -- Only preserve 'running' status to avoid interrupting active crawls
              status = case 
                when page_fetch.status = 'running' then page_fetch.status 
                else 'queued' 
              end,
              requested_by = coalesce(excluded.requested_by, page_fetch.requested_by),
              priority = greatest(page_fetch.priority, excluded.priority),
              last_cursor = excluded.last_cursor,
              -- Reset timestamps when re-queuing
              started_at = case when page_fetch.status = 'running' then page_fetch.started_at else null end,
              finished_at = null,
              last_error = null
            """,
            info["page_id"], req.requested_by, req.priority, json.dumps(cursor_data)
        )
        
        return {"ok": True, "page": info, "link_direction": req.link_direction}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/jobs")
async def jobs():
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select pf.page_id, pf.status, pf.priority, pf.started_at, pf.finished_at, pf.last_error,
               pf.last_cursor,
               p.title, p.out_degree, p.in_degree
        from page_fetch pf join pages p on p.page_id=pf.page_id
        order by
          case pf.status when 'running' then 0 when 'queued' then 1 when 'error' then 2 else 3 end,
          pf.priority desc, pf.updated_at desc
        limit 200
        """
    )
    return {"jobs": [dict(r) for r in rows]}

@router.post("/jobs/{page_id}/cancel")
async def cancel_job(page_id: int):
    """Cancel a running or queued job"""
    pool = await get_pool()
    result = await pool.execute(
        """
        UPDATE page_fetch 
        SET status = 'paused', last_error = 'Cancelled by user'
        WHERE page_id = $1 AND status IN ('queued', 'running')
        """,
        page_id
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Job not found or cannot be cancelled")
    return {"ok": True, "message": f"Job {page_id} cancelled"}

