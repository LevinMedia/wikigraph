from __future__ import annotations
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential_jitter
from .settings import settings

HEADERS = {"User-Agent": settings.USER_AGENT}

@retry(stop=stop_after_attempt(5), wait=wait_exponential_jitter(initial=0.5, max=8))
async def api_get(params: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0, headers=HEADERS) as client:
        r = await client.get(settings.WIKI_API_BASE, params=params)
        r.raise_for_status()
        return r.json()

async def resolve_title(title: str) -> dict:
    """
    Resolve a title to canonical pageid and normalized title.
    Also handles redirects.
    """
    data = await api_get({
        "action": "query",
        "format": "json",
        "redirects": 1,
        "titles": title,
        "prop": "info",
        "inprop": "url"
    })
    pages = data.get("query", {}).get("pages", {})
    page = next(iter(pages.values()))
    return {
        "page_id": int(page["pageid"]),
        "title": page["title"],
        "namespace": int(page.get("ns", 0)),
        "is_redirect": bool(page.get("redirect", False)),
        "fullurl": page.get("fullurl")
    }

from typing import Optional, Tuple, List, Dict

async def fetch_all_outlinks(page_id: int, allow_namespaces: set[int]) -> Tuple[List[Dict], Optional[Dict]]:
    """
    Fetch ALL outbound links (paginated) for a page_id.
    Returns (links, final_continue_blob).
    Each link item: {"title": ..., "ns": ..., "page_id": optional if resolved later}
    """
    cont = None
    out: list[dict] = []

    while True:
        params = {
            "action": "query",
            "format": "json",
            "pageids": str(page_id),
            "prop": "links",
            "pllimit": "max",
        }
        if cont:
            params.update(cont)

        data = await api_get(params)
        pages = data.get("query", {}).get("pages", {})
        page = pages.get(str(page_id), {})
        links = page.get("links", []) or []

        for l in links:
            ns = int(l.get("ns", 0))
            if ns in allow_namespaces:
                out.append({"title": l["title"], "ns": ns})

        cont = data.get("continue")
        if not cont:
            break

    return out, None

async def fetch_all_backlinks(page_id: int, allow_namespaces: set[int]) -> Tuple[List[Dict], Optional[Dict]]:
    """
    Fetch ALL inbound links (backlinks - pages that link TO this page).
    Returns (links, final_continue_blob).
    Each link item: {"title": ..., "ns": ..., "page_id": optional if resolved later}
    """
    cont = None
    out: list[dict] = []

    while True:
        params = {
            "action": "query",
            "format": "json",
            "list": "backlinks",
            "blpageid": str(page_id),
            "bllimit": "max",
            "blnamespace": "|".join(str(ns) for ns in allow_namespaces),
        }
        if cont:
            params.update(cont)

        data = await api_get(params)
        backlinks = data.get("query", {}).get("backlinks", []) or []

        for bl in backlinks:
            ns = int(bl.get("ns", 0))
            if ns in allow_namespaces:
                out.append({"title": bl["title"], "ns": ns})

        cont = data.get("continue")
        if not cont:
            break

    return out, None

async def fetch_page_extract(page_id: int) -> str:
    """
    Fetch full text extract for a page_id.
    Uses prop=extracts with exintro=false to get full text, explaintext=true for plain text.
    """
    data = await api_get({
        "action": "query",
        "format": "json",
        "pageids": str(page_id),
        "prop": "extracts",
        "exintro": "false",  # Get full text, not just intro
        "explaintext": "true"  # Plain text, no HTML
    })
    pages = data.get("query", {}).get("pages", {})
    page = pages.get(str(page_id), {})
    extract = page.get("extract", "")
    return extract

async def fetch_page_categories(page_id: int) -> list[str]:
    """
    Fetch categories for a page_id.
    Returns list of category names (without "Category:" prefix).
    """
    cont = None
    categories: list[str] = []
    
    while True:
        params = {
            "action": "query",
            "format": "json",
            "pageids": str(page_id),
            "prop": "categories",
            "cllimit": "max",
        }
        if cont:
            params.update(cont)
        
        data = await api_get(params)
        pages = data.get("query", {}).get("pages", {})
        page = pages.get(str(page_id), {})
        cats = page.get("categories", []) or []
        
        for cat in cats:
            title = cat.get("title", "")
            # Remove "Category:" prefix if present
            if title.startswith("Category:"):
                title = title[9:]
            categories.append(title)
        
        cont = data.get("continue")
        if not cont:
            break
    
    return categories

async def batch_fetch_page_data(page_ids: list[int]) -> dict[int, dict]:
    """
    Batch fetch extracts and categories for multiple pages.
    Returns dict mapping page_id to {"extract": str, "categories": list[str], "title": str}.
    """
    # Wikipedia API allows up to 50 pageids per request
    batch_size = 50
    result: dict[int, dict] = {}
    
    for i in range(0, len(page_ids), batch_size):
        batch = page_ids[i:i + batch_size]
        pageids_str = "|".join(str(pid) for pid in batch)
        
        # Fetch extracts and categories in one request
        data = await api_get({
            "action": "query",
            "format": "json",
            "pageids": pageids_str,
            "prop": "extracts|categories|info",
            "exintro": "false",
            "explaintext": "true",
            "cllimit": "max",
        })
        
        pages = data.get("query", {}).get("pages", {})
        
        for page_id_str, page in pages.items():
            page_id = int(page_id_str)
            extract = page.get("extract", "")
            title = page.get("title", "")
            
            # Get categories
            categories: list[str] = []
            cats = page.get("categories", []) or []
            for cat in cats:
                cat_title = cat.get("title", "")
                if cat_title.startswith("Category:"):
                    cat_title = cat_title[9:]
                categories.append(cat_title)
            
            result[page_id] = {
                "extract": extract,
                "categories": categories,
                "title": title,
            }
        
        # Handle pagination for categories if needed
        cont = data.get("continue")
        if cont and "clcontinue" in cont:
            # Fetch remaining categories
            for page_id in batch:
                if page_id in result:
                    # Fetch remaining categories for this page
                    remaining_cats = await fetch_page_categories(page_id)
                    # Merge with existing categories
                    existing = set(result[page_id]["categories"])
                    for cat in remaining_cats:
                        if cat not in existing:
                            result[page_id]["categories"].append(cat)
    
    return result

