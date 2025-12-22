from __future__ import annotations
from typing import Optional, List, Dict
from openai import AsyncOpenAI
from .settings import settings
import logging

logger = logging.getLogger(__name__)

# Initialize OpenAI client
client = None

def get_openai_client():
    """Get or create OpenAI async client"""
    global client
    if client is None:
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not set in environment")
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return client

async def analyze_relationship_cluster(
    pages_data: List[dict],
    edges: List[dict],
    center_title: str,
    selected_title: str,
    conversation_history: Optional[List[dict]] = None
) -> str:
    """
    Analyze a cluster of related Wikipedia pages using OpenAI.
    
    Args:
        pages_data: List of dicts with keys: page_id, title, extract, categories
        edges: List of dicts with keys: from, to
        center_title: Title of the center node
        selected_title: Title of the selected node
        conversation_history: Previous messages for follow-up questions
    
    Returns:
        Analysis text from the LLM
    """
    if not settings.OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not set. Please add it to your .env file.")
    
    client = get_openai_client()
    
    # Build system prompt
    system_prompt = """You are an expert at analyzing Wikipedia page relationships. Your task is to find interesting, non-obvious connections between pages that form a relationship cluster.

When analyzing relationships, look for:
- Thematic connections (shared topics, concepts, or domains)
- Historical or causal relationships
- Structural patterns (hubs, bridges, clusters)
- Surprising or unexpected connections
- Common categories or classification patterns
- Narrative threads that connect the pages

Be insightful and specific. Avoid generic statements. Focus on what makes THIS particular cluster interesting."""

    # Format pages data for the prompt
    pages_text = "## Pages in the Relationship Cluster\n\n"
    for page in pages_data:
        title = page.get("title", "Unknown")
        extract = page.get("extract", "")
        categories = page.get("categories", [])
        
        # Truncate extract if too long (keep first 2000 chars)
        if len(extract) > 2000:
            extract = extract[:2000] + "... [truncated]"
        
        pages_text += f"### {title}\n\n"
        if extract:
            pages_text += f"**Content:** {extract}\n\n"
        if categories:
            pages_text += f"**Categories:** {', '.join(categories[:10])}"  # Limit to 10 categories
            if len(categories) > 10:
                pages_text += f" (and {len(categories) - 10} more)"
            pages_text += "\n\n"
    
    # Format edges
    edges_text = "## Relationships (Links Between Pages)\n\n"
    if edges:
        edges_text += f"Total connections: {len(edges)}\n\n"
        # Show a sample of edges (up to 20)
        sample_edges = edges[:20]
        for edge in sample_edges:
            from_title = next((p.get("title") for p in pages_data if p.get("page_id") == edge.get("from")), "Unknown")
            to_title = next((p.get("title") for p in pages_data if p.get("page_id") == edge.get("to")), "Unknown")
            edges_text += f"- {from_title} → {to_title}\n"
        if len(edges) > 20:
            edges_text += f"\n... and {len(edges) - 20} more connections\n"
    else:
        edges_text += "No direct connections between these pages.\n"
    
    # Build user prompt
    user_prompt = f"""Analyze the relationship cluster centered around "{center_title}" with selected node "{selected_title}".

{pages_text}

{edges_text}

Provide a comprehensive analysis that explains:
1. Why these pages are connected
2. What themes or patterns emerge
3. Any surprising or non-obvious relationships
4. The overall structure and significance of this cluster

Be specific, insightful, and focus on what makes this particular cluster interesting."""

    # Build messages
    messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history if provided (for follow-up questions)
    if conversation_history:
        messages.extend(conversation_history)
    
    # Add current analysis request
    messages.append({"role": "user", "content": user_prompt})
    
    try:
        # Call OpenAI API (async)
        response = await client.chat.completions.create(
            model="gpt-4o",  # Using gpt-4o for better analysis
            messages=messages,
            temperature=0.7,
            max_tokens=2000,
        )
        
        analysis = response.choices[0].message.content
        return analysis.strip() if analysis else "No analysis generated."
    
    except Exception as e:
        logger.error(f"Error calling OpenAI API: {e}")
        raise Exception(f"Failed to analyze relationships: {str(e)}")

