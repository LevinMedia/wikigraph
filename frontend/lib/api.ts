import { supabase, requireSupabase } from './supabase'

export interface GraphNode {
  page_id: number
  title: string
  out_degree: number
  in_degree: number
  is_center: boolean
}

export interface GraphEdge {
  from: number
  to: number
}

export interface GraphEgoResponse {
  center_page_id: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface Job {
  page_id: number
  status: 'queued' | 'running' | 'done' | 'error' | 'paused'
  priority: number
  started_at: string | null
  finished_at: string | null
  last_error: string | null
  title: string
  out_degree: number
  in_degree: number
}

/**
 * Fetch 1-hop ego graph: center node and its direct neighbors only
 * Includes edges from center to neighbors AND edges between neighbors
 */
export async function fetchEgoGraph(
  pageId: number,
  limitNeighbors: number = 500
): Promise<GraphEgoResponse> {
  const db = requireSupabase()

  // Get center page
  const { data: centerPage, error: centerError } = await db
    .from('pages')
    .select('*')
    .eq('page_id', pageId)
    .single()

  if (centerError || !centerPage) {
    return { center_page_id: pageId, nodes: [], edges: [] }
  }

  // Get first-degree neighbors (direct connections only)
  const { data: outLinks } = await db
    .from('links')
    .select('to_page_id')
    .eq('from_page_id', pageId)
    .limit(limitNeighbors)

  const { data: inLinks } = await db
    .from('links')
    .select('from_page_id')
    .eq('to_page_id', pageId)
    .limit(limitNeighbors)

  // Collect first-degree neighbor IDs
  const neighborIds = new Set<number>()
  if (outLinks) {
    outLinks.forEach((link: any) => neighborIds.add(link.to_page_id))
  }
  if (inLinks) {
    inLinks.forEach((link: any) => neighborIds.add(link.from_page_id))
  }

  // Combine center + neighbors
  const allNodeIds = new Set<number>([pageId])
  neighborIds.forEach(id => allNodeIds.add(id))
  const nodeIdsArray = Array.from(allNodeIds)

  // Fetch all page details
  const { data: pagesData, error: pagesError } = await db
    .from('pages')
    .select('page_id, title, out_degree, in_degree')
    .in('page_id', nodeIdsArray)

  if (pagesError) {
    throw new Error(`Failed to fetch page details: ${pagesError.message}`)
  }

  // Build nodes list
  const nodes: GraphNode[] = (pagesData || []).map((page: any) => ({
    page_id: page.page_id,
    title: page.title,
    out_degree: page.out_degree,
    in_degree: page.in_degree,
    is_center: page.page_id === pageId,
  }))

  // Get ALL edges: edges connected to center AND edges between neighbors
  const { data: allEdges } = await db
    .from('links')
    .select('from_page_id, to_page_id')
    .in('from_page_id', nodeIdsArray)
    .in('to_page_id', nodeIdsArray)

  // Build edges list (all edges between nodes in our graph)
  const edges: GraphEdge[] = []
  if (allEdges) {
    allEdges.forEach((edge: any) => {
      edges.push({
        from: edge.from_page_id,
        to: edge.to_page_id,
      })
    })
  }

  return {
    center_page_id: pageId,
    nodes,
    edges,
  }
}

/**
 * Fetch all nodes and edges from the database (full graph)
 */
export async function fetchAllGraph(
  limit: number = 1000
): Promise<GraphEgoResponse> {
  const db = requireSupabase()

  // Get all pages with links - fetch all of them, no limit needed for now
  // Use separate queries for out_degree > 0 and in_degree > 0, then combine
  const { data: pagesOut, error: errorOut } = await db
    .from('pages')
    .select('page_id, title, out_degree, in_degree')
    .gt('out_degree', 0)
    .order('out_degree', { ascending: false })
    .limit(limit)
  
  const { data: pagesIn, error: errorIn } = await db
    .from('pages')
    .select('page_id, title, out_degree, in_degree')
    .gt('in_degree', 0)
    .order('in_degree', { ascending: false })
    .limit(limit)
  
  if (errorOut || errorIn) {
    throw new Error(`Failed to fetch pages: ${errorOut?.message || errorIn?.message}`)
  }
  
  // Combine and deduplicate pages
  const pagesMap = new Map<number, any>()
  if (pagesOut) {
    pagesOut.forEach((p: any) => pagesMap.set(p.page_id, p))
  }
  if (pagesIn) {
    pagesIn.forEach((p: any) => {
      if (!pagesMap.has(p.page_id)) {
        pagesMap.set(p.page_id, p)
      }
    })
  }
  
  const pages = Array.from(pagesMap.values())
  console.log(`[fetchAllGraph] Found ${pages.length} unique pages`)
  
  if (pages.length === 0) {
    return { center_page_id: 0, nodes: [], edges: [] }
  }

  const pageIds = pages.map((p: any) => p.page_id)

  // Get all edges where either endpoint is in our page set
  // Use two separate queries and combine them
  const { data: edgesFrom, error: errorFrom } = await db
    .from('links')
    .select('from_page_id, to_page_id')
    .in('from_page_id', pageIds)
  
  const { data: edgesTo, error: errorTo } = await db
    .from('links')
    .select('from_page_id, to_page_id')
    .in('to_page_id', pageIds)
  
  if (errorFrom || errorTo) {
    throw new Error(`Failed to fetch edges: ${errorFrom?.message || errorTo?.message}`)
  }
  
  // Combine and deduplicate edges
  const edgesMap = new Map<string, any>()
  if (edgesFrom) {
    edgesFrom.forEach((e: any) => {
      const key = `${e.from_page_id}-${e.to_page_id}`
      edgesMap.set(key, e)
    })
  }
  if (edgesTo) {
    edgesTo.forEach((e: any) => {
      const key = `${e.from_page_id}-${e.to_page_id}`
      edgesMap.set(key, e)
    })
  }
  
  const allEdges = Array.from(edgesMap.values())
  console.log(`[fetchAllGraph] Found ${allEdges.length} unique edges`)
  
  // Collect all page IDs referenced in edges (might include pages not in our initial query)
  const allReferencedPageIds = new Set<number>(pageIds)
  allEdges.forEach((edge: any) => {
    allReferencedPageIds.add(edge.from_page_id)
    allReferencedPageIds.add(edge.to_page_id)
  })
  
  // Fetch any missing pages that are referenced in edges
  const missingPageIds = Array.from(allReferencedPageIds).filter(id => !pageIds.includes(id))
  if (missingPageIds.length > 0) {
    const { data: missingPages } = await db
      .from('pages')
      .select('page_id, title, out_degree, in_degree')
      .in('page_id', missingPageIds)
    
    if (missingPages) {
      missingPages.forEach((p: any) => {
        if (!pagesMap.has(p.page_id)) {
          pagesMap.set(p.page_id, p)
        }
      })
    }
  }

  // Build nodes map from all pages (including newly fetched ones)
  const allPages = Array.from(pagesMap.values())
  const nodesMap = new Map<number, GraphNode>()
  allPages.forEach((page: any) => {
    nodesMap.set(page.page_id, {
      page_id: page.page_id,
      title: page.title,
      out_degree: page.out_degree,
      in_degree: page.in_degree,
      is_center: false,
    })
  })
  
  console.log(`[fetchAllGraph] Total nodes in map: ${nodesMap.size}`)

  // Mark first page as center for visualization
  if (pages.length > 0) {
    const centerId = pages[0].page_id
    const centerNode = nodesMap.get(centerId)
    if (centerNode) {
      centerNode.is_center = true
    }
  }

  // Build edges - include all edges where both endpoints are in our node set
  const edges: GraphEdge[] = []
  allEdges.forEach((edge: any) => {
    if (nodesMap.has(edge.from_page_id) && nodesMap.has(edge.to_page_id)) {
      edges.push({ from: edge.from_page_id, to: edge.to_page_id })
    }
  })
  
  console.log(`[fetchAllGraph] Final: ${nodesMap.size} nodes, ${edges.length} edges`)

  return {
    center_page_id: allPages.length > 0 ? allPages[0].page_id : 0,
    nodes: Array.from(nodesMap.values()),
    edges,
  }
}


/**
 * Search pages by title (type-ahead)
 */
export async function searchPages(query: string, limit: number = 10): Promise<GraphNode[]> {
  const db = requireSupabase()
  
  if (!query || query.trim().length < 2) {
    return []
  }
  
  const searchTerm = query.trim()
  
  console.log(`[searchPages] Searching for: "${searchTerm}"`)
  
  // Use ilike directly - this should work with Supabase
  const { data, error } = await db
    .from('pages')
    .select('page_id, title, out_degree, in_degree')
    .ilike('title', `%${searchTerm}%`)
    .order('out_degree', { ascending: false })
    .limit(limit)
  
  if (error) {
    console.error('[searchPages] Search error:', error)
    console.error('[searchPages] Error details:', JSON.stringify(error, null, 2))
    return []
  }
  
  console.log(`[searchPages] Found ${data?.length || 0} results for "${searchTerm}"`)
  
  if (error) {
    console.error('Search error:', error)
    return []
  }
  
  console.log(`[searchPages] Found ${data?.length || 0} results for "${searchTerm}"`)
  
  return (data || []).map((page: any) => ({
    page_id: page.page_id,
    title: page.title,
    out_degree: page.out_degree || 0,
    in_degree: page.in_degree || 0,
    is_center: false,
  }))
}

/**
 * Fetch jobs directly from Supabase
 * This reads from the database, not the backend API
 */
export async function fetchJobs(): Promise<{ jobs: Job[] }> {
  const db = requireSupabase()

  // Fetch jobs
  const { data: jobsData, error: jobsError } = await db
    .from('page_fetch')
    .select('page_id, status, priority, started_at, finished_at, last_error')
    .order('status', { ascending: true })
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(200)

  if (jobsError) {
    throw new Error(`Failed to fetch jobs: ${jobsError.message}`)
  }

  if (!jobsData || jobsData.length === 0) {
    return { jobs: [] }
  }

  // Fetch corresponding page data
  const pageIds = jobsData.map((j: any) => j.page_id)
  const { data: pagesData } = await db
    .from('pages')
    .select('page_id, title, out_degree, in_degree')
    .in('page_id', pageIds)

  const pagesMap = new Map<number, any>()
  if (pagesData) {
    pagesData.forEach((page: any) => {
      pagesMap.set(page.page_id, page)
    })
  }

  const jobs: Job[] = (jobsData || []).map((row: any) => {
    const page = pagesMap.get(row.page_id)
    return {
      page_id: row.page_id,
      status: row.status,
      priority: row.priority,
      started_at: row.started_at,
      finished_at: row.finished_at,
      last_error: row.last_error,
      title: page?.title || 'Unknown',
      out_degree: page?.out_degree || 0,
      in_degree: page?.in_degree || 0,
    }
  })

  return { jobs }
}

