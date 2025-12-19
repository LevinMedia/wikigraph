from __future__ import annotations
import asyncio
from typing import Iterable, Union
from .db import get_pool
from .settings import settings
from .wiki_api import resolve_title, fetch_all_outlinks, fetch_all_backlinks, api_get

def parse_namespaces(s: str) -> set[int]:
    return {int(x.strip()) for x in s.split(",") if x.strip() != ""}

ALLOW_NS = parse_namespaces(settings.ALLOW_NAMESPACES)

async def upsert_page(pool, page_id: int, title: str, namespace: int, is_redirect: bool = False):
    await pool.execute(
        """
        insert into pages (page_id, title, namespace, is_redirect)
        values ($1, $2, $3, $4)
        on conflict (page_id) do update set
          title = excluded.title,
          namespace = excluded.namespace,
          is_redirect = excluded.is_redirect
        """,
        page_id, title, namespace, is_redirect
    )

from typing import Optional

async def enqueue_by_page_id(pool, page_id: int, requested_by: Optional[str] = None, priority: int = 0, link_direction: str = "outbound"):
    import json
    cursor_data = {"link_direction": link_direction}
    await pool.execute(
        """
        insert into page_fetch (page_id, status, requested_by, priority, last_cursor)
        values ($1, 'queued', $2, $3, $4::jsonb)
        on conflict (page_id) do update set
          status = case when page_fetch.status in ('done','running') then page_fetch.status else 'queued' end,
          requested_by = coalesce(excluded.requested_by, page_fetch.requested_by),
          priority = greatest(page_fetch.priority, excluded.priority),
          last_cursor = coalesce(excluded.last_cursor, page_fetch.last_cursor)
        """,
        page_id, requested_by, priority, json.dumps(cursor_data)
    )

async def batch_resolve_titles_to_ids(titles: list[str]) -> dict[str, dict]:
    """
    Resolve many titles -> page_id via 'titles=' batching.
    """
    # MediaWiki titles param is pipe-separated; keep batches small
    out: dict[str, dict] = {}
    batch_size = 40

    for i in range(0, len(titles), batch_size):
        chunk = titles[i:i+batch_size]
        data = await api_get({
            "action": "query",
            "format": "json",
            "redirects": 1,
            "titles": "|".join(chunk),
            "prop": "info"
        })
        pages = data.get("query", {}).get("pages", {})
        for p in pages.values():
            if "missing" in p:
                continue
            out[p["title"]] = {
                "page_id": int(p["pageid"]),
                "title": p["title"],
                "namespace": int(p.get("ns", 0)),
                "is_redirect": bool(p.get("redirect", False)),
            }
    return out

async def insert_links(pool, from_ids: Union[int, list[int]], to_ids: list[int]):
    # batch insert with ON CONFLICT DO NOTHING
    # from_ids can be a single int or a list (for batch inserts)
    if not to_ids:
        return

    if isinstance(from_ids, int):
        # Single from_id, multiple to_ids
        from_ids_list = [from_ids] * len(to_ids)
    else:
        # Multiple from_ids (must match length of to_ids)
        from_ids_list = from_ids

    # chunk to avoid giant query
    chunk_size = 5000
    for i in range(0, len(to_ids), chunk_size):
        chunk_from = from_ids_list[i:i+chunk_size]
        chunk_to = to_ids[i:i+chunk_size]
        await pool.executemany(
            """
            insert into links (from_page_id, to_page_id)
            values ($1, $2)
            on conflict do nothing
            """,
            list(zip(chunk_from, chunk_to))
        )

async def recompute_degrees(pool, page_id: int):
    # recompute degrees for just this page (fast-ish)
    out_deg = await pool.fetchval("select count(*) from links where from_page_id=$1", page_id)
    in_deg = await pool.fetchval("select count(*) from links where to_page_id=$1", page_id)
    await pool.execute(
        "update pages set out_degree=$2, in_degree=$3 where page_id=$1",
        page_id, int(out_deg), int(in_deg)
    )

async def claim_next_job(pool):
    # First, mark any jobs that have been running for more than 2 hours as error (stuck jobs)
    await pool.execute(
        """
        update page_fetch
        set status='error', last_error='Job stuck in running state for more than 2 hours'
        where status='running' 
          and started_at is not null 
          and started_at < now() - interval '2 hours'
        """
    )
    
    # atomically claim a queued job
    row = await pool.fetchrow(
        """
        update page_fetch
        set status='running', started_at=coalesce(started_at, now()), last_error=null
        where page_id = (
          select page_id from page_fetch
          where status='queued'
          order by priority desc, updated_at asc
          limit 1
          for update skip locked
        )
        returning page_id
        """
    )
    return int(row["page_id"]) if row else None

async def mark_done(pool, page_id: int):
    await pool.execute(
        "update page_fetch set status='done', finished_at=now() where page_id=$1",
        page_id
    )

async def mark_error(pool, page_id: int, err: str):
    await pool.execute(
        "update page_fetch set status='error', last_error=$2 where page_id=$1",
        page_id, err[:5000]
    )

async def update_progress(pool, page_id: int, stage: str, count: int = 0):
    """Update progress in last_cursor field as JSON, preserving existing data like link_direction"""
    import json
    # Get existing cursor to preserve link_direction and other metadata
    existing = await pool.fetchval("SELECT last_cursor FROM page_fetch WHERE page_id = $1", page_id)
    cursor_data = {"stage": stage, "count": count}
    
    # Preserve existing metadata (like link_direction, auto_crawl)
    if existing:
        try:
            if isinstance(existing, str):
                existing_data = json.loads(existing)
            else:
                existing_data = existing
            # Preserve link_direction and auto_crawl if they exist
            if "link_direction" in existing_data:
                cursor_data["link_direction"] = existing_data["link_direction"]
            if "auto_crawl" in existing_data:
                cursor_data["auto_crawl"] = existing_data["auto_crawl"]
        except:
            pass  # If we can't parse, just use the new data
    
    await pool.execute(
        "update page_fetch set last_cursor = $1::jsonb where page_id = $2",
        json.dumps(cursor_data),
        page_id
    )

async def crawl_one_page(pool, page_id: int, link_direction: str = "outbound"):
    """
    Crawl a page. link_direction can be "outbound" (default) or "inbound" (backlinks)
    """
    # 0) Ensure the source page exists in pages table (might not if it was just discovered)
    page_exists = await pool.fetchval("SELECT page_id FROM pages WHERE page_id = $1", page_id)
    if not page_exists:
        # Fetch page info from Wikipedia API to create the page record
        from .wiki_api import api_get
        data = await api_get({
            "action": "query",
            "format": "json",
            "pageids": str(page_id),
            "prop": "info"
        })
        pages = data.get("query", {}).get("pages", {})
        if str(page_id) in pages:
            page_info = pages[str(page_id)]
            await upsert_page(
                pool,
                page_id,
                page_info["title"],
                int(page_info.get("ns", 0)),
                bool(page_info.get("redirect", False))
            )
        else:
            # Page doesn't exist in Wikipedia - skip crawling
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Page {page_id} not found in Wikipedia API, skipping crawl")
            return []
    
    # 1) fetch links based on direction
    await update_progress(pool, page_id, f"fetching_{link_direction}_links", 0)
    
    if link_direction == "inbound":
        links, _ = await fetch_all_backlinks(page_id, ALLOW_NS)
    else:
        links, _ = await fetch_all_outlinks(page_id, ALLOW_NS)
    
    await update_progress(pool, page_id, "links_fetched", len(links))

    if settings.MAX_LINKS_PER_PAGE and settings.MAX_LINKS_PER_PAGE > 0:
        links = links[: settings.MAX_LINKS_PER_PAGE]

    titles = [l["title"] for l in links]
    await update_progress(pool, page_id, "resolving_titles", len(titles))
    resolved = await batch_resolve_titles_to_ids(titles)
    await update_progress(pool, page_id, "titles_resolved", len(resolved))

    # 2) upsert target pages, insert edges
    target_ids: list[int] = []
    inserted = 0
    for t in titles:
        info = resolved.get(t)
        if not info:
            continue
        await upsert_page(pool, info["page_id"], info["title"], info["namespace"], info["is_redirect"])
        target_ids.append(info["page_id"])
        inserted += 1
        # Update progress every 50 pages
        if inserted % 50 == 0:
            await update_progress(pool, page_id, "inserting_pages", inserted)

    await update_progress(pool, page_id, "inserting_links", len(target_ids))
    
    # Filter out any target_ids that don't exist in pages table (shouldn't happen, but safety check)
    if target_ids:
        existing_targets = await pool.fetch(
            "SELECT page_id FROM pages WHERE page_id = ANY($1::int[])",
            target_ids
        )
        existing_target_set = {row["page_id"] for row in existing_targets}
        target_ids = [tid for tid in target_ids if tid in existing_target_set]
    
    # Insert edges: for inbound, reverse the direction
    if link_direction == "inbound":
        # For inbound, we need to ensure all backlink pages exist before inserting links FROM them
        if target_ids:
            await insert_links(pool, target_ids, [page_id] * len(target_ids))  # from each backlink TO this page
    else:
        # For outbound, page_id should already exist (checked at start of function)
        if target_ids:
            await insert_links(pool, page_id, target_ids)  # from this page TO each outlink
    
    await update_progress(pool, page_id, "computing_degrees", 0)
    await recompute_degrees(pool, page_id)
    
    return target_ids

async def crawl_both_directions(pool, page_id: int):
    """
    Crawl both inbound and outbound links for a page.
    Returns the set of all connected page IDs.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Crawl outbound
    logger.info(f"Crawling outbound links for page {page_id}")
    outbound_ids = await crawl_one_page(pool, page_id, "outbound")
    
    # Crawl inbound
    logger.info(f"Crawling inbound links for page {page_id}")
    inbound_ids = await crawl_one_page(pool, page_id, "inbound")
    
    # Combine and return unique set
    all_connected = set(outbound_ids) | set(inbound_ids)
    return all_connected

async def mark_as_discovered(pool, page_ids: list[int], requested_by: Optional[str] = None):
    """
    Mark pages as 'discovered' (second-degree nodes that haven't been crawled yet).
    """
    if not page_ids:
        return
    
    import json
    cursor_data = {"link_direction": "outbound"}  # Default, will be set when actually crawled
    
    for page_id in page_ids:
        await pool.execute(
            """
            insert into page_fetch (page_id, status, requested_by, priority, last_cursor)
            values ($1, 'discovered', $2, 0, $3::jsonb)
            on conflict (page_id) do update set
              status = case 
                when page_fetch.status in ('done', 'running', 'queued') then page_fetch.status
                else 'discovered'
              end,
              requested_by = coalesce(excluded.requested_by, page_fetch.requested_by),
              last_cursor = coalesce(excluded.last_cursor, page_fetch.last_cursor)
            """,
            page_id, requested_by, json.dumps(cursor_data)
        )

async def crawl_with_neighbors(pool, initial_page_id: int):
    """
    Main orchestration function:
    1. Crawl both inbound and outbound for initial page (page 0)
    2. Enqueue each 1st degree neighbor as a separate job (visible in dashboard)
    3. When first-degree neighbors are processed, they'll discover second-degree nodes
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Step 1: Crawl initial page (both directions) - this is "page 0"
    logger.info(f"Starting crawl for initial page {initial_page_id}")
    await update_progress(pool, initial_page_id, "crawling_initial_page", 0)
    initial_connected = await crawl_both_directions(pool, initial_page_id)
    logger.info(f"Initial page {initial_page_id} connected to {len(initial_connected)} pages")
    
    # Step 2: Get first-degree neighbors (nodes directly connected to initial page)
    first_degree_ids = list(initial_connected)
    logger.info(f"Found {len(first_degree_ids)} first-degree neighbors")
    
    # Step 3: Enqueue first-degree neighbors as separate jobs (they'll be processed by the crawler loop)
    # These jobs will crawl both directions and discover second-degree nodes
    import json
    for first_degree_id in first_degree_ids:
        # Check if already queued, running, or done
        existing_status = await pool.fetchval(
            "SELECT status FROM page_fetch WHERE page_id = $1", 
            first_degree_id
        )
        
        # Only enqueue if not already done or running
        if existing_status != 'done' and existing_status != 'running':
            cursor_data = {
                "link_direction": "outbound",  # Will crawl both directions
                "crawl_with_neighbors": False,  # Don't crawl neighbors of neighbors (that would be 3rd degree)
                "is_first_degree_of": initial_page_id  # Track which initial page this belongs to
            }
            await pool.execute(
                """
                INSERT INTO page_fetch (page_id, status, priority, last_cursor, requested_by)
                VALUES ($1, 'queued', 0, $2::jsonb, $3)
                ON CONFLICT (page_id) DO UPDATE SET
                  status = CASE 
                    WHEN page_fetch.status = 'running' THEN page_fetch.status
                    WHEN page_fetch.status = 'done' THEN page_fetch.status
                    ELSE 'queued'
                  END,
                  last_cursor = COALESCE(excluded.last_cursor, page_fetch.last_cursor)
                """,
                first_degree_id, 
                json.dumps(cursor_data),
                f"first_degree_of_{initial_page_id}"
            )
            logger.info(f"Enqueued first-degree neighbor {first_degree_id} as separate job")
    
    # Step 4: Mark initial page as done (first-degree neighbors will be processed by crawler loop)
    await mark_done(pool, initial_page_id)
    logger.info(f"Completed initial page {initial_page_id}: enqueued {len(first_degree_ids)} first-degree neighbors")

async def crawler_loop(stop_event: asyncio.Event):
    import logging
    logger = logging.getLogger(__name__)
    logger.info("Crawler loop started")
    
    try:
        pool = await get_pool()
        logger.info("Database pool acquired")
    except Exception as e:
        logger.error(f"Failed to get database pool: {e}", exc_info=True)
        raise
    
    sem = asyncio.Semaphore(settings.CRAWLER_CONCURRENCY)

    async def worker():
        logger.info(f"Crawler worker started")
        while not stop_event.is_set():
            page_id = await claim_next_job(pool)
            if not page_id:
                await asyncio.sleep(settings.CRAWLER_POLL_SECONDS)
                continue
            
            logger.info(f"Claimed job: page_id={page_id}")

            async with sem:
                # Check if job was cancelled before starting
                status = await pool.fetchval("SELECT status FROM page_fetch WHERE page_id = $1", page_id)
                if status != 'running':
                    continue
                
                # Get crawl configuration from last_cursor
                import json
                cursor_json = await pool.fetchval("SELECT last_cursor FROM page_fetch WHERE page_id = $1", page_id)
                link_direction = "outbound"  # default
                crawl_with_neighbors_flag = False
                
                if cursor_json:
                    try:
                        cursor = json.loads(cursor_json) if isinstance(cursor_json, str) else cursor_json
                        link_direction = cursor.get("link_direction", "outbound")
                        crawl_with_neighbors_flag = cursor.get("crawl_with_neighbors", False)
                    except:
                        pass
                
                try:
                        if crawl_with_neighbors_flag:
                            # Use new orchestration function (it handles marking done internally)
                            await crawl_with_neighbors(pool, page_id)
                            # Double-check it was marked as done
                            final_status = await pool.fetchval("SELECT status FROM page_fetch WHERE page_id = $1", page_id)
                            if final_status == 'running':
                                logger.warning(f"Job {page_id} still running after crawl_with_neighbors, marking as done")
                                await mark_done(pool, page_id)
                        else:
                            # Check if this is a first-degree neighbor job that needs to discover second-degree nodes
                            is_first_degree_of = None
                            if cursor_json:
                                try:
                                    cursor = json.loads(cursor_json) if isinstance(cursor_json, str) else cursor_json
                                    is_first_degree_of = cursor.get("is_first_degree_of")
                                except:
                                    pass
                            
                            if is_first_degree_of:
                                # This is a first-degree neighbor job - crawl it and discover second-degree nodes
                                logger.info(f"Processing first-degree neighbor {page_id} of initial page {is_first_degree_of}")
                                await crawl_both_directions(pool, page_id)
                                
                                # Discover second-degree nodes (connected to this first-degree neighbor, but not the initial page or other first-degree neighbors)
                                # Get all first-degree neighbors of the initial page
                                initial_outbound = await pool.fetch(
                                    "SELECT to_page_id FROM links WHERE from_page_id = $1", is_first_degree_of
                                )
                                initial_inbound = await pool.fetch(
                                    "SELECT from_page_id FROM links WHERE to_page_id = $1", is_first_degree_of
                                )
                                first_degree_set = {is_first_degree_of}  # Include initial page
                                for row in initial_outbound:
                                    first_degree_set.add(row['to_page_id'])
                                for row in initial_inbound:
                                    first_degree_set.add(row['from_page_id'])
                                
                                # Get all connections of this first-degree neighbor
                                neighbor_outbound = await pool.fetch(
                                    "SELECT to_page_id FROM links WHERE from_page_id = $1", page_id
                                )
                                neighbor_inbound = await pool.fetch(
                                    "SELECT from_page_id FROM links WHERE to_page_id = $1", page_id
                                )
                                
                                second_degree = set()
                                for row in neighbor_outbound:
                                    connected_id = row['to_page_id']
                                    if connected_id not in first_degree_set:
                                        second_degree.add(connected_id)
                                for row in neighbor_inbound:
                                    connected_id = row['from_page_id']
                                    if connected_id not in first_degree_set:
                                        second_degree.add(connected_id)
                                
                                # Mark second-degree nodes as discovered
                                if second_degree:
                                    second_degree_list = list(second_degree)
                                    logger.info(f"Discovered {len(second_degree_list)} second-degree nodes from first-degree neighbor {page_id}")
                                    await mark_as_discovered(pool, second_degree_list, f"discovered_from_first_degree_{page_id}")
                            else:
                                # Regular single-direction crawl
                                await crawl_one_page(pool, page_id, link_direction)
                            
                        # Always check and mark as done if still running (unless cancelled)
                        status = await pool.fetchval("SELECT status FROM page_fetch WHERE page_id = $1", page_id)
                        if status == 'running':
                            logger.info(f"Marking job {page_id} as done")
                            await mark_done(pool, page_id)
                        elif status != 'done' and status != 'error':
                            logger.warning(f"Job {page_id} has unexpected status '{status}' after completion, marking as done")
                            await mark_done(pool, page_id)
                except Exception as e:
                    logger.error(f"Error processing job {page_id}: {e}", exc_info=True)
                    # Make sure we mark as error even if something goes wrong
                    try:
                        status = await pool.fetchval("SELECT status FROM page_fetch WHERE page_id = $1", page_id)
                        if status == 'running':
                            await mark_error(pool, page_id, repr(e))
                    except Exception as inner_e:
                        logger.error(f"Failed to mark job {page_id} as error: {inner_e}")

    # Run N workers
    logger.info(f"Creating {settings.CRAWLER_CONCURRENCY} crawler workers")
    tasks = [asyncio.create_task(worker()) for _ in range(settings.CRAWLER_CONCURRENCY)]
    try:
        await asyncio.gather(*tasks)
    except Exception as e:
        logger.error(f"Crawler loop error: {e}", exc_info=True)
        raise

