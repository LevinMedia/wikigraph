# Progressive Discovery Caching Layer - Implementation Plan

## Overview

This document outlines the plan to implement a progressive discovery caching layer for relationship analysis. The goal is to preserve the current user experience while adding intelligent caching to avoid token overages and improve performance.

## Current State

### Current Flow

1. **User clicks a first-degree node** in the graph
2. **System identifies relationships:**
   - Primary: `center ↔ selected` (direct relationship)
   - Additional: Nodes that are 1st-degree neighbors of BOTH center and selected
3. **Single LLM call** with full context:
   - Center page (full raw wikitext)
   - Selected page (full raw wikitext)
   - All additional relationship pages (full raw wikitext)
4. **Agent analyzes everything at once** and produces:
   - **Primary Relationship**: Detailed markdown analysis of center ↔ selected
   - **Additional Relationships**: Bulleted list showing how each additional node connects to both center and selected

### Current Architecture

**Files:**
- `frontend/app/api/graph/analyze-relationships/route.ts` - Main API route
- `frontend/app/api/graph/analyze-relationships/agent.ts` - Agent creation and context building
- `frontend/app/api/graph/analyze-relationships/tools.ts` - Tool definitions
- `frontend/app/api/graph/analyze-relationships/wiki-utils.ts` - Wikipedia data fetching

**Agent:**
- Name: "Wikipedia Relationship Analyzer"
- Model: `gpt-4o`
- Tools: `fetchWikipediaPageDataTool`, `getLinkDirectionTool`, `getPageDetailsTool`

**Output Format:**
- Rich markdown with:
  - Selected node details
  - Center node details
  - Primary relationship (detailed analysis)
  - Additional relationships (bulleted list with one-sentence descriptions)

### Current Problems

1. **Token Overages**: When analyzing large clusters (many additional relationships), sending all full page content exceeds token limits (30k TPM)
2. **Redundant Work**: Same edges are analyzed repeatedly across different user sessions
3. **No Caching**: Every analysis requires full LLM call, even for previously analyzed relationships

## Proposed Changes

### Core Strategy

**Break down the single large LLM call into multiple smaller, cacheable edge analyses:**

1. **Primary edge**: `center ↔ selected` (1 edge)
2. **Additional relationship edges**: For each additional node, analyze:
   - `additional ↔ center` (N edges)
   - `additional ↔ selected` (N edges)

**Total edges to analyze:** `1 + (2 × N)` where N = number of additional relationship nodes

### Key Principles

1. **Preserve Output Format**: User sees exactly the same rich markdown output
2. **Progressive Generation**: Check cache first, only generate what's missing
3. **Individual Edge Caching**: Each edge analyzed once, cached, and reused
4. **Token Control**: Each LLM call only processes 2 pages (from + to)

## Database Schema Changes

### New Table: `wiki_edge_summaries`

```sql
CREATE TABLE wiki_edge_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Edge identification
  from_page_id bigint NOT NULL,
  to_page_id bigint NOT NULL,
  direction text NOT NULL,  -- 'inbound' | 'outbound' | 'bidirectional'
  
  -- Analysis metadata
  model text NOT NULL DEFAULT 'gpt-4o',
  prompt_version int NOT NULL DEFAULT 1,
  
  -- Content versioning (optional)
  from_revision text NULL,  -- Wikipedia page revision/timestamp
  to_revision text NULL,
  
  -- Analysis results
  found boolean NOT NULL DEFAULT true,
  summary text NOT NULL,  -- Main relationship summary (1-3 sentences)
  evidence jsonb NOT NULL,  -- { quotes: string[], locations: string[] }
  relationship_type text NULL,  -- 'featured_in' | 'born_in' | 'located_in' | etc.
  confidence real NOT NULL DEFAULT 0.7,  -- 0.0 to 1.0
  
  -- Status tracking
  status text NOT NULL DEFAULT 'ready',  -- 'ready' | 'pending' | 'error'
  error_message text NULL,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL  -- TTL (e.g., 30 days)
);

-- Unique constraint: one analysis per edge configuration
CREATE UNIQUE INDEX wiki_edge_summaries_unique_idx ON wiki_edge_summaries (
  from_page_id,
  to_page_id,
  direction,
  model,
  prompt_version,
  COALESCE(from_revision, ''),
  COALESCE(to_revision, '')
);

-- Performance indexes
CREATE INDEX wiki_edge_summaries_expires_idx ON wiki_edge_summaries (expires_at);
CREATE INDEX wiki_edge_summaries_edge_lookup_idx ON wiki_edge_summaries (from_page_id, to_page_id);
CREATE INDEX wiki_edge_summaries_status_idx ON wiki_edge_summaries (status);
```

### Migration Script

Create: `backend/scripts/create_wiki_edge_summaries_table.sql`

## Implementation Plan

### Phase 1: Database Setup

1. Create migration script for `wiki_edge_summaries` table
2. Add indexes and constraints
3. Test migration on local database

### Phase 2: Cache Module

Create: `frontend/app/api/graph/analyze-relationships/cache.ts`

**Functions:**
- `readEdgeSummary(fromPageId, toPageId, direction, model, promptVersion)` - Check cache
- `upsertEdgeSummary(edgeData)` - Store/update cache
- `isExpired(summary)` - Check if cache entry is expired
- `batchReadEdgeSummaries(edges[])` - Bulk cache lookup

**Cache Logic:**
- Check `expires_at` - if `NULL` or `expires_at > now()`, cache is valid
- On read: update `last_accessed_at`
- On write: set `expires_at = now() + interval '30 days'`

### Phase 3: Edge Analysis Module

Create: `frontend/app/api/graph/analyze-relationships/edge-analyzer.ts`

**Functions:**
- `analyzeEdge(fromPageId, toPageId, direction, fromTitle, toTitle)` - Analyze single edge
- `parseAnalysisOutput(llmResponse)` - Parse agent output into structured format
- `formatEdgeSummary(analysisData)` - Format for caching

**Agent Output Contract:**
The agent should return structured JSON for edge analyses:

```json
{
  "found": true,
  "relationship_summary": "1-3 sentence summary",
  "evidence_quotes": ["short exact quote", "..."],
  "evidence_locations": ["section name / table name", "..."],
  "relationship_type": "featured_in|born_in|located_in|episode_about|other",
  "confidence": 0.0-1.0
}
```

**Note**: For the primary relationship (center ↔ selected), we may want to keep the rich markdown format. For additional relationships, we'll use the structured JSON format.

### Phase 4: Progressive Analysis API

Modify: `frontend/app/api/graph/analyze-relationships/route.ts`

**New Flow:**

1. **Identify edges to analyze:**
   - Primary: `center ↔ selected`
   - Additional: For each additional node:
     - `additional ↔ center`
     - `additional ↔ selected`

2. **Batch cache lookup:**
   - Query cache for all required edges
   - Separate into: cached (ready), missing, expired

3. **Progressive generation:**
   - Use cached results immediately
   - Generate missing/expired edges with concurrency cap (2-4 at a time)
   - Store new results in cache

4. **Combine results:**
   - Primary relationship: Use cached or generate (rich markdown)
   - Additional relationships: Combine cached summaries into bulleted list format

5. **Return same format:**
   - Preserve exact output structure user sees now

### Phase 5: Agent Updates

Modify: `frontend/app/api/graph/analyze-relationships/agent.ts`

**Changes:**
1. Create separate agent configuration for edge analysis (2-page context)
2. Update instructions to return structured JSON for edge analyses
3. Keep rich markdown format option for primary relationship

**New Function:**
- `createEdgeAnalyzerAgent(fromTitle, toTitle, direction)` - Agent for single edge analysis

### Phase 6: Tool Updates

Modify: `frontend/app/api/graph/analyze-relationships/tools.ts`

**Add to agent tools:**
- `getRelationshipEdgesTool` - Currently defined but not in agent's tools array

This tool is needed to discover the cluster graph structure.

## API Endpoints

### Existing (Modified)
- `POST /api/graph/analyze-relationships` - Main endpoint, now uses caching

### New (Optional)
- `POST /api/edge-summary` - Get or create summary for single edge
- `POST /api/selection-summaries` - Batch get summaries for selection context

## Output Format Preservation

The user-facing output will remain **exactly the same**:

```markdown
**Selected Node**
- Key details...

**Center Node**
- Key details...

**Primary Relationship**
- Detailed analysis...

**Additional Relationships**
- **Node 1**: One sentence description...
- **Node 2**: One sentence description...
```

The difference is:
- **Before**: All generated in one LLM call
- **After**: Assembled from cached + newly generated edge analyses

## Caching Strategy Details

### Cache Key Components
- `from_page_id`
- `to_page_id`
- `direction` (inbound/outbound/bidirectional)
- `model` (gpt-4o)
- `prompt_version` (for future prompt updates)
- `from_revision` / `to_revision` (optional, for content versioning)

### Cache Invalidation
- **TTL-based**: Default 30 days
- **Manual refresh**: Force refresh option
- **Content-based**: If revision tracking available, invalidate on content change

### Concurrency Control
- **Pending status**: Mark edges as "pending" during generation to prevent duplicate work
- **Concurrency cap**: Generate 2-4 edges simultaneously
- **Max edges per request**: Limit to prevent token overages (e.g., 10 edges max per request)

## Migration Path

### Step 1: Database Migration
- Run migration script
- Verify table creation

### Step 2: Cache Module
- Implement cache read/write functions
- Test with sample data

### Phase 3: Edge Analyzer
- Implement single edge analysis
- Test with known edges

### Phase 4: Integration
- Modify main route to use caching
- Test end-to-end flow

### Phase 5: UI Updates (if needed)
- Show "analyzing..." for pending edges
- Handle partial results gracefully

## Testing Strategy

1. **Cache hit**: Verify cached results are used correctly
2. **Cache miss**: Verify new analysis is generated and cached
3. **Expired cache**: Verify expired entries are regenerated
4. **Token limits**: Test with large clusters to ensure progressive generation works
5. **Output format**: Verify output matches current format exactly

## Future Enhancements

1. **Relationship Importance Ranking**: Implement hybrid ranking system (graph + evidence + semantic)
2. **Background job**: Pre-generate popular edges
3. **Session cache**: Short-term cache for current session
4. **Evidence viewer**: UI to show quotes and locations
5. **Confidence filtering**: Hide low-confidence relationships
6. **Revision tracking**: Automatic cache invalidation on page updates

## Relationship Importance Ranking (Future Enhancement)

> **Note**: This feature will be implemented after the core caching layer is complete. It's documented here for future reference.

### Problem Statement

When analyzing relationships, we may discover many "additional relationships" (nodes that are 1st-degree neighbors of both center and selected). Currently, all are treated equally. We need a way to rank them by importance to:
- Show most significant connections first
- Reduce cognitive load when there are many relationships
- Help users discover the most interesting connections

### Ranking Approaches

#### 1. **Graph-Based Metrics** (Fast, No LLM Cost)

**Degree Centrality:**
- Count total connections (in + out) for each additional relationship node
- Higher degree = more central/important in the graph
- **Pros**: Fast, already have this data (`in_degree`, `out_degree` in `pages` table)
- **Cons**: Doesn't capture semantic importance, just connectivity

**Betweenness Centrality:**
- How often a node appears on shortest paths between other nodes
- Nodes that "bridge" different parts of the graph are more important
- **Pros**: Captures structural importance
- **Cons**: More expensive to compute, requires full graph traversal

**PageRank-like Algorithm:**
- Weighted importance based on incoming links
- More important pages link to it = higher importance
- **Pros**: Wikipedia-specific, captures notability
- **Cons**: Requires graph computation, may not reflect relationship strength

**Edge Weight/Strength:**
- Count how many paths connect through this node
- If node connects to many other nodes in the cluster, it's more important
- **Pros**: Simple, relationship-specific
- **Cons**: May favor highly connected nodes over semantically important ones

#### 2. **Content-Based Metrics** (Requires Analysis)

**Mention Frequency:**
- Count how many times the additional relationship is mentioned in center/selected pages
- More mentions = more important
- **Pros**: Captures explicit importance
- **Cons**: Requires text analysis, may miss implicit importance

**Mention Position:**
- Earlier mentions (intro, first sections) = more important
- Mentions in headings/bold = more important
- **Pros**: Captures Wikipedia's own emphasis
- **Cons**: Requires parsing page structure

**Context Quality:**
- Length of description/section about the relationship
- More detailed = more important
- **Pros**: Captures depth of connection
- **Cons**: Requires content analysis

**Evidence Strength:**
- From edge analysis: confidence score, number of evidence quotes
- Higher confidence + more evidence = more important
- **Pros**: Uses our own analysis data
- **Cons**: Only available after analysis

#### 3. **LLM-Based Scoring** (Most Accurate, Higher Cost)

**Semantic Importance Score:**
- After analyzing each edge, have the agent score importance (1-10)
- Based on: significance, uniqueness, informativeness
- **Pros**: Captures semantic meaning, most accurate
- **Cons**: Additional LLM call per edge, higher cost

**Relationship Type Weighting:**
- Some relationship types are inherently more important:
  - `featured_in` (episode about) > `mentioned_in` (passing reference)
  - `born_in` / `located_in` (core attribute) > `visited` (temporary)
- **Pros**: Semantic understanding
- **Cons**: Requires relationship type classification

**Comparative Analysis:**
- Have agent compare all additional relationships and rank them
- Single LLM call with all summaries
- **Pros**: Context-aware ranking
- **Cons**: Requires all analyses first, then ranking call

#### 4. **Hybrid Approach** (Recommended)

Combine multiple signals into a composite score:

```typescript
importanceScore = (
  graphScore * 0.2 +        // Degree centrality (fast)
  contentScore * 0.3 +       // Mention frequency/position (medium cost)
  evidenceScore * 0.3 +      // From edge analysis (already computed)
  semanticScore * 0.2        // LLM importance rating (optional, higher cost)
)
```

**Implementation Strategy:**

1. **Phase 1: Fast Graph Metrics** (implement first)
   - Use `in_degree + out_degree` from `pages` table
   - Sort additional relationships by total degree
   - Zero cost, immediate results

2. **Phase 2: Content Analysis** (add after caching)
   - Extract mention counts from edge analysis evidence
   - Use position data if available
   - Low cost, uses existing data

3. **Phase 3: Evidence-Based** (add with edge analyzer)
   - Use `confidence` and `evidence_quotes.length` from `wiki_edge_summaries`
   - Higher confidence + more evidence = higher importance
   - Zero additional cost (uses cached data)

4. **Phase 4: LLM Scoring** (optional enhancement)
   - Add `importance_score` field to edge analysis
   - Agent rates 1-10 based on significance
   - Higher cost, but most accurate

### Database Schema Addition

Add to `wiki_edge_summaries` table:

```sql
ALTER TABLE wiki_edge_summaries ADD COLUMN importance_score real NULL;
-- 0.0 to 10.0, NULL if not yet scored

CREATE INDEX wiki_edge_summaries_importance_idx ON wiki_edge_summaries (importance_score DESC NULLS LAST);
```

### Ranking Implementation

**Function:** `rankAdditionalRelationships(relationships[], method)`

**Methods:**
- `'graph'` - Degree centrality only (fastest)
- `'evidence'` - Confidence + evidence count (fast, uses cache)
- `'hybrid'` - Combined graph + evidence + content (balanced)
- `'semantic'` - LLM-based scoring (most accurate, slower)

**Output:**
- Sorted array of relationships with importance scores
- Top N relationships (e.g., top 10) shown prominently
- Remaining relationships in "See more..." section

### UI Considerations

1. **Top Relationships Section:**
   - Show top 5-10 most important relationships
   - Each with importance indicator (star rating, score, or badge)

2. **Collapsible "All Relationships":**
   - Remaining relationships in expandable section
   - Still searchable/filterable

3. **Sorting Options:**
   - User can toggle: "Most Important" vs "Alphabetical" vs "Most Connected"

4. **Visual Indicators:**
   - Highlight top relationships in the graph
   - Show importance score in tooltip

### Recommendation

**Start with Hybrid Approach (Graph + Evidence):**

1. **Immediate**: Use degree centrality for initial ranking
2. **After caching**: Add evidence-based scoring (confidence + quote count)
3. **Future enhancement**: Add optional LLM importance scoring for top relationships

This gives good results with minimal cost, and can be enhanced later.

## Questions to Resolve

1. **Primary relationship caching**: Should we cache the primary relationship (center ↔ selected) or always generate fresh?
2. **Output format for edges**: Should additional relationships use structured JSON or keep markdown format?
3. **Concurrency limits**: What's the optimal number of simultaneous edge analyses?
4. **TTL duration**: Is 30 days appropriate, or should it be configurable?
5. **Importance ranking**: Deferred to future enhancement - will implement hybrid graph + evidence approach after core caching is complete

## Files to Create/Modify

### New Files
- `docs/progressive-discovery-plan.md` (this file)
- `backend/scripts/create_wiki_edge_summaries_table.sql`
- `frontend/app/api/graph/analyze-relationships/cache.ts`
- `frontend/app/api/graph/analyze-relationships/edge-analyzer.ts`

### Modified Files
- `frontend/app/api/graph/analyze-relationships/route.ts`
- `frontend/app/api/graph/analyze-relationships/agent.ts`
- `frontend/app/api/graph/analyze-relationships/tools.ts`

## Success Criteria

1. ✅ Output format matches current implementation exactly
2. ✅ Token usage stays within limits (no 429 errors)
3. ✅ Cached edges are reused across sessions
4. ✅ Progressive generation works for large clusters
5. ✅ Performance improvement (faster responses for cached edges)

