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

    # Step 1: Get first-degree neighbors (outbound + inbound)
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

    # Build set of first-degree neighbor IDs
    first_degree_ids = set()
    for r in list(out_rows) + list(in_rows):
        first_degree_ids.add(int(r["page_id"]))

    # Step 2: Get second-degree neighbors (neighbors of first-degree neighbors)
    # Since we're using a nodes_map that deduplicates, we can just fetch all neighbors
    # and let the map handle duplicates
    second_degree_rows = []
    if first_degree_ids:
        # Get all links from first-degree nodes (don't exclude - let nodes_map handle duplicates)
        second_degree_out = await pool.fetch(
            """
            select distinct p.page_id, p.title, p.out_degree, p.in_degree
            from links l 
            join pages p on p.page_id=l.to_page_id
            where l.from_page_id = any($1::bigint[])
            limit $2
            """,
            list(first_degree_ids), limit_neighbors
        )
        
        # Get all links to first-degree nodes (don't exclude - let nodes_map handle duplicates)
        second_degree_in = await pool.fetch(
            """
            select distinct p.page_id, p.title, p.out_degree, p.in_degree
            from links l 
            join pages p on p.page_id=l.from_page_id
            where l.to_page_id = any($1::bigint[])
            limit $2
            """,
            list(first_degree_ids), limit_neighbors
        )
        
        second_degree_rows = list(second_degree_out) + list(second_degree_in)

    # Step 3: Build complete node list (center + first-degree + second-degree)
    nodes_map = {
        int(center["page_id"]): {
            "page_id": int(center["page_id"]),
            "title": center["title"],
            "out_degree": int(center["out_degree"]),
            "in_degree": int(center["in_degree"]),
            "is_center": True,
        }
    }

    # Add first-degree nodes
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

    # Add second-degree nodes
    for r in second_degree_rows:
        pid = int(r["page_id"])
        if pid not in nodes_map:
            nodes_map[pid] = {
                "page_id": pid,
                "title": r["title"],
                "out_degree": int(r["out_degree"]),
                "in_degree": int(r["in_degree"]),
                "is_center": False,
            }

    # Step 4: Get all edges between all nodes (center, first-degree, and second-degree)
    all_node_ids = list(nodes_map.keys())
    all_edges = await pool.fetch(
        """
        select from_page_id, to_page_id
        from links
        where from_page_id = any($1::bigint[])
        and to_page_id = any($1::bigint[])
        """,
        all_node_ids
    )

    edges = []
    for r in all_edges:
        edges.append({"from": int(r["from_page_id"]), "to": int(r["to_page_id"])})

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

