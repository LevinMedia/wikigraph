from fastapi import APIRouter, Query
from .db import get_pool
from .models import GraphEgoResponse

router = APIRouter(prefix="/api/graph", tags=["graph"])

@router.get("/ego", response_model=GraphEgoResponse)
async def ego(page_id: int = Query(...), limit_neighbors: int = Query(500)):
    pool = await get_pool()

    center = await pool.fetchrow("select * from pages where page_id=$1", page_id)
    if not center:
        return GraphEgoResponse(center_page_id=page_id, nodes=[], edges=[])

    # neighbors: outbound + inbound (bounded)
    out_rows = await pool.fetch(
        """
        select p.page_id, p.title, p.out_degree, p.in_degree
        from links l join pages p on p.page_id=l.to_page_id
        where l.from_page_id=$1
        limit $2
        """,
        page_id, limit_neighbors
    )

    in_rows = await pool.fetch(
        """
        select p.page_id, p.title, p.out_degree, p.in_degree
        from links l join pages p on p.page_id=l.from_page_id
        where l.to_page_id=$1
        limit $2
        """,
        page_id, limit_neighbors
    )

    # build node list (center + unique neighbors)
    nodes_map = {
        int(center["page_id"]): {
            "page_id": int(center["page_id"]),
            "title": center["title"],
            "out_degree": int(center["out_degree"]),
            "in_degree": int(center["in_degree"]),
            "is_center": True,
        }
    }

    for r in list(out_rows) + list(in_rows):
        pid = int(r["page_id"])
        if pid not in nodes_map:
            nodes_map[pid] = {
                "page_id": pid,
                "title": r["title"],
                "out_degree": int(r["out_degree"]),
                "in_degree": int(r["in_degree"]),
                "is_center": False,
            }

    # edges only among returned nodes: center->out + in->center
    edges = []
    for r in out_rows:
        edges.append({"from": page_id, "to": int(r["page_id"])})
    for r in in_rows:
        edges.append({"from": int(r["page_id"]), "to": page_id})

    return GraphEgoResponse(center_page_id=page_id, nodes=list(nodes_map.values()), edges=edges)

@router.get("/all", response_model=GraphEgoResponse)
async def all_nodes(limit: int = Query(1000, description="Maximum number of nodes to return")):
    """Get all nodes and edges in the database (full graph)"""
    pool = await get_pool()
    
    # Get all pages (up to limit)
    pages = await pool.fetch(
        """
        select page_id, title, out_degree, in_degree
        from pages
        where out_degree > 0 or in_degree > 0
        order by (out_degree + in_degree) desc
        limit $1
        """,
        limit
    )
    
    if not pages:
        return GraphEgoResponse(center_page_id=0, nodes=[], edges=[])
    
    # Build nodes map
    page_ids = [int(p["page_id"]) for p in pages]
    nodes_map = {}
    for p in pages:
        nodes_map[int(p["page_id"])] = {
            "page_id": int(p["page_id"]),
            "title": p["title"],
            "out_degree": int(p["out_degree"]),
            "in_degree": int(p["in_degree"]),
            "is_center": False,
        }
    
    # Get all edges between these pages
    edges = []
    edge_rows = await pool.fetch(
        """
        select from_page_id, to_page_id
        from links
        where from_page_id = any($1::bigint[]) and to_page_id = any($1::bigint[])
        """,
        page_ids
    )
    
    for r in edge_rows:
        edges.append({"from": int(r["from_page_id"]), "to": int(r["to_page_id"])})
    
    # Use first page as "center" for visualization purposes
    center_id = int(pages[0]["page_id"])
    if center_id in nodes_map:
        nodes_map[center_id]["is_center"] = True
    
    return GraphEgoResponse(center_page_id=center_id, nodes=list(nodes_map.values()), edges=edges)

