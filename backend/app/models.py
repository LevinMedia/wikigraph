from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class EnqueueRequest(BaseModel):
    title: str
    requested_by: Optional[str] = None
    priority: int = 0
    link_direction: str = "outbound"  # "outbound" or "inbound"
    auto_crawl_neighbors: bool = False  # Automatically enqueue linked pages

class GraphEgoResponse(BaseModel):
    center_page_id: int
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, int]]

