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
        
        # Store crawl configuration in last_cursor
        # Always use crawl_with_neighbors for new enqueues (crawl initial + first-degree, discover second-degree)
        import json
        cursor_data = {
            "link_direction": req.link_direction,
            "crawl_with_neighbors": True  # Always crawl with neighbors for new enqueues
        }
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
    # Fetch jobs with better ordering to ensure done jobs are included
    # Strategy: Get a mix of active jobs AND recent done jobs
    # Use UNION to get both active jobs and done jobs separately
    active_rows = await pool.fetch(
        """
        select pf.page_id, pf.status, pf.priority, pf.started_at, pf.finished_at, pf.last_error,
               pf.last_cursor,
               coalesce(p.title, 'Unknown') as title, 
               coalesce(p.out_degree, 0) as out_degree, 
               coalesce(p.in_degree, 0) as in_degree
        from page_fetch pf 
        left join pages p on p.page_id=pf.page_id
        where pf.status in ('running', 'queued', 'error', 'paused', 'discovered')
        order by
          case pf.status 
            when 'running' then 0 
            when 'queued' then 1 
            when 'error' then 2 
            when 'paused' then 3
            when 'discovered' then 4
            else 5
          end,
          pf.priority desc, 
          pf.updated_at desc
        limit 500
        """
    )
    
    done_rows = await pool.fetch(
        """
        select pf.page_id, pf.status, pf.priority, pf.started_at, pf.finished_at, pf.last_error,
               pf.last_cursor,
               coalesce(p.title, 'Unknown') as title, 
               coalesce(p.out_degree, 0) as out_degree, 
               coalesce(p.in_degree, 0) as in_degree
        from page_fetch pf 
        left join pages p on p.page_id=pf.page_id
        where pf.status = 'done'
        order by pf.finished_at desc
        limit 500
        """
    )
    
    # Combine results: active jobs first, then done jobs
    all_rows = list(active_rows) + list(done_rows)
    return {"jobs": [dict(r) for r in all_rows]}

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

@router.post("/kill-all-running")
async def kill_all_running():
    """Kill all running and queued jobs"""
    pool = await get_pool()
    result = await pool.execute(
        """
        UPDATE page_fetch 
        SET status = 'paused', last_error = 'Killed by admin'
        WHERE status IN ('queued', 'running')
        """
    )
    return {"ok": True, "message": f"Killed all running/queued jobs", "affected": result}

@router.post("/stop-crawler")
async def stop_crawler():
    """Stop the crawler loop (will restart on next request or server restart)"""
    from .main import _stop_event
    _stop_event.set()
    return {"ok": True, "message": "Crawler stop signal sent (will restart on server restart)"}

@router.post("/delete-all-data")
async def delete_all_data():
    """Delete all data from the database (DANGEROUS - for testing only)"""
    pool = await get_pool()
    try:
        # Delete in order to respect foreign key constraints
        await pool.execute("DELETE FROM page_categories")
        await pool.execute("DELETE FROM page_fetch")
        await pool.execute("DELETE FROM links")
        await pool.execute("DELETE FROM pages")
        await pool.execute("DELETE FROM categories")
        return {"ok": True, "message": "All data deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting data: {str(e)}")

