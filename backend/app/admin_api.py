from fastapi import APIRouter, HTTPException, Query
from .db import get_pool
from .models import EnqueueRequest
from .wiki_api import resolve_title, fetch_all_outlinks, fetch_all_backlinks
from .crawler import upsert_page, enqueue_by_page_id, batch_resolve_titles_to_ids, parse_namespaces
from .settings import settings

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
async def jobs(limit: int = Query(10000, description="Maximum number of jobs to return"), offset: int = Query(0, description="Offset for pagination")):
    import json
    pool = await get_pool()
    
    # Get total counts for each status
    total_counts = await pool.fetchrow(
        """
        select 
          count(*) filter (where status in ('running', 'queued', 'error', 'paused', 'discovered')) as active_count,
          count(*) filter (where status = 'done') as done_count,
          count(*) filter (where status = 'discovered') as discovered_count,
          count(*) as total_count
        from page_fetch
        """
    )
    
    # Fetch ALL jobs (no limit on individual queries, but we'll limit the combined result)
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
        order by pf.finished_at asc
        """
    )
    
    # Combine results: active jobs first, then done jobs
    all_rows = list(active_rows) + list(done_rows)
    
    # Apply pagination
    total_jobs = len(all_rows)
    paginated_rows = all_rows[offset:offset + limit]
    
    # Parse cursor data to extract degree and root_page_id
    jobs_list = []
    for row in paginated_rows:
        job_dict = dict(row)
        # Parse last_cursor to extract degree and root_page_id
        cursor_data = None
        if job_dict.get('last_cursor'):
            try:
                cursor_data = json.loads(job_dict['last_cursor']) if isinstance(job_dict['last_cursor'], str) else job_dict['last_cursor']
            except:
                pass
        
        # Extract degree and root_page_id from cursor
        job_dict['degree'] = cursor_data.get('degree') if cursor_data else None
        job_dict['root_page_id'] = cursor_data.get('root_page_id') if cursor_data else None
        
        # Extract progress information
        job_dict['progress_stage'] = cursor_data.get('stage') if cursor_data else None
        job_dict['progress_count'] = cursor_data.get('count') if cursor_data else None
        
        jobs_list.append(job_dict)
    
    return {
        "jobs": jobs_list,
        "pagination": {
            "total": total_jobs,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total_jobs
        },
        "counts": {
            "active": total_counts['active_count'] if total_counts else 0,
            "done": total_counts['done_count'] if total_counts else 0,
            "discovered": total_counts['discovered_count'] if total_counts else 0,
            "total": total_counts['total_count'] if total_counts else 0
        }
    }

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

@router.get("/estimate-blast-radius")
async def estimate_blast_radius(title: str = Query(..., description="Wikipedia page title or URL")):
    """
    Estimate the "blast radius" - how many pages will need to be scraped
    for a given URL with the current setup (root + first-degree + second-degree discovered).
    This does NOT actually crawl or store anything - it's a dry run estimate.
    """
    import re
    from urllib.parse import unquote
    
    ALLOW_NS = parse_namespaces(settings.ALLOW_NAMESPACES)
    
    try:
        # Extract title from URL if needed
        if "wikipedia.org" in title:
            match = re.search(r'/wiki/([^?#]+)', title)
            if match:
                title = unquote(match.group(1).replace("_", " "))
        
        # Resolve the root page
        page_info = await resolve_title(title)
        root_page_id = page_info["page_id"]
        root_title = page_info["title"]
        
        # Fetch first-degree neighbors (inbound + outbound)
        outbound_links, _ = await fetch_all_outlinks(root_page_id, ALLOW_NS)
        inbound_links, _ = await fetch_all_backlinks(root_page_id, ALLOW_NS)
        
        # Resolve all first-degree link titles to page IDs
        all_first_degree_titles = [l["title"] for l in outbound_links + inbound_links]
        first_degree_resolved = await batch_resolve_titles_to_ids(all_first_degree_titles)
        
        # Get unique first-degree page IDs
        first_degree_page_ids = set()
        for title in all_first_degree_titles:
            if title in first_degree_resolved:
                first_degree_page_ids.add(first_degree_resolved[title]["page_id"])
        
        first_degree_count = len(first_degree_page_ids)
        
        # For each first-degree neighbor, fetch their links to estimate second-degree
        # Limit to avoid taking too long - sample up to 100 first-degree neighbors
        second_degree_titles_set = set()
        first_degree_sample = list(first_degree_page_ids)[:100]  # Sample first 100
        
        for first_degree_id in first_degree_sample:
            try:
                fd_outbound, _ = await fetch_all_outlinks(first_degree_id, ALLOW_NS)
                fd_inbound, _ = await fetch_all_backlinks(first_degree_id, ALLOW_NS)
                for link in fd_outbound + fd_inbound:
                    second_degree_titles_set.add(link["title"])
            except Exception as e:
                # Skip if we can't fetch links for this page
                continue
        
        # Estimate second-degree count (accounting for sampling)
        if len(first_degree_page_ids) > 100:
            # Extrapolate: if we sampled 100 and found X unique second-degree titles,
            # estimate for all first-degree neighbors
            sample_ratio = 100 / len(first_degree_page_ids)
            estimated_second_degree_unique = len(second_degree_titles_set) / sample_ratio if sample_ratio > 0 else len(second_degree_titles_set)
        else:
            # We checked all first-degree neighbors
            estimated_second_degree_unique = len(second_degree_titles_set)
        
        # Remove first-degree pages from second-degree estimate (deduplication)
        # We can't resolve all second-degree titles, so we'll estimate overlap
        # Typically ~10-20% of second-degree are also first-degree
        estimated_overlap = estimated_second_degree_unique * 0.15  # Rough estimate
        estimated_second_degree_discovered = max(0, estimated_second_degree_unique - estimated_overlap - first_degree_count)
        
        # Total estimate
        total_estimate = 1 + first_degree_count + int(estimated_second_degree_discovered)
        
        return {
            "root": {
                "page_id": root_page_id,
                "title": root_title
            },
            "estimates": {
                "root_pages": 1,
                "first_degree_to_crawl": first_degree_count,
                "second_degree_to_discover": int(estimated_second_degree_discovered),
                "total_pages": total_estimate
            },
            "breakdown": {
                "outbound_links": len(outbound_links),
                "inbound_links": len(inbound_links),
                "first_degree_sampled": len(first_degree_sample),
                "first_degree_total": len(first_degree_page_ids),
                "second_degree_titles_found": len(second_degree_titles_set),
                "estimated_second_degree_unique": int(estimated_second_degree_unique)
            },
            "note": "This is an estimate. Actual counts may vary due to redirects, deleted pages, and deduplication."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error estimating blast radius: {str(e)}")

