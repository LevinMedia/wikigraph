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
    
    # Insert edges: for inbound, reverse the direction
    if link_direction == "inbound":
        await insert_links(pool, target_ids, [page_id] * len(target_ids))  # from each backlink TO this page
    else:
        await insert_links(pool, page_id, target_ids)  # from this page TO each outlink
    
    await update_progress(pool, page_id, "computing_degrees", 0)
    await recompute_degrees(pool, page_id)
    
    # Check if we should auto-enqueue neighbors for sequential crawling
    import json
    cursor_json = await pool.fetchval("SELECT last_cursor FROM page_fetch WHERE page_id = $1", page_id)
    auto_crawl = False
    if cursor_json:
        try:
            cursor = json.loads(cursor_json) if isinstance(cursor_json, str) else cursor_json
            auto_crawl = cursor.get("auto_crawl") == "true" or cursor.get("auto_crawl") is True
        except:
            pass
    
    if auto_crawl and target_ids:
        # Enqueue all linked pages with lower priority for sequential crawling
        await update_progress(pool, page_id, "enqueueing_neighbors", len(target_ids))
        for target_id in target_ids[:100]:  # Limit to 100 to avoid explosion
            await enqueue_by_page_id(pool, target_id, f"auto_from_{page_id}", priority=-1, link_direction="outbound")
    
    await update_progress(pool, page_id, "done", len(target_ids))

async def crawler_loop(stop_event: asyncio.Event):
    import logging
    logger = logging.getLogger(__name__)
    logger.info("Crawler loop started")
    
    pool = await get_pool()
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
                try:
                    # Check if job was cancelled before starting
                    status = await pool.fetchval("SELECT status FROM page_fetch WHERE page_id = $1", page_id)
                    if status != 'running':
                        continue
                    
                    # Get link direction from last_cursor
                    import json
                    cursor_json = await pool.fetchval("SELECT last_cursor FROM page_fetch WHERE page_id = $1", page_id)
                    link_direction = "outbound"  # default
                    if cursor_json:
                        try:
                            cursor = json.loads(cursor_json) if isinstance(cursor_json, str) else cursor_json
                            link_direction = cursor.get("link_direction", "outbound")
                        except:
                            pass
                    
                    await crawl_one_page(pool, page_id, link_direction)
                    
                    # Check again before marking done (might have been cancelled)
                    status = await pool.fetchval("SELECT status FROM page_fetch WHERE page_id = $1", page_id)
                    if status == 'running':
                        await mark_done(pool, page_id)
                except Exception as e:
                    logger.error(f"Error processing job {page_id}: {e}", exc_info=True)
                    await mark_error(pool, page_id, repr(e))

    # run N workers
    tasks = [asyncio.create_task(worker()) for _ in range(settings.CRAWLER_CONCURRENCY)]
    await asyncio.gather(*tasks)

