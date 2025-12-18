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

