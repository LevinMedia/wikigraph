import { tool } from '@openai/agents'
import { createClient } from '@supabase/supabase-js'
import { fetchWikipediaPageData } from './wiki-utils'

// Server-side Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Tool to get the direction of a link between two pages
 */
export const getLinkDirectionTool = tool({
  name: 'get_link_direction',
  description: 'Get the direction of the link between two pages. Returns "inbound" if link goes from selected to center, "outbound" if from center to selected, or "bidirectional" if both directions exist.',
  parameters: {
    type: 'object',
    properties: {
      fromPageId: {
        type: 'number',
        description: 'The source page ID',
      },
      toPageId: {
        type: 'number',
        description: 'The target page ID',
      },
    },
    required: ['fromPageId', 'toPageId'],
    additionalProperties: false,
  },
  async execute({ fromPageId, toPageId }: { fromPageId: number; toPageId: number }) {
    const { data } = await supabase
      .from('links')
      .select('from_page_id, to_page_id')
      .or(`and(from_page_id.eq.${fromPageId},to_page_id.eq.${toPageId}),and(from_page_id.eq.${toPageId},to_page_id.eq.${fromPageId})`)
    
    const hasForward = data?.some((l: any) => l.from_page_id === fromPageId && l.to_page_id === toPageId)
    const hasReverse = data?.some((l: any) => l.from_page_id === toPageId && l.to_page_id === fromPageId)
    
    if (hasForward && hasReverse) {
      return JSON.stringify({ direction: 'bidirectional' })
    } else if (hasReverse) {
      return JSON.stringify({ direction: 'inbound', note: 'Link goes from target to source' })
    } else if (hasForward) {
      return JSON.stringify({ direction: 'outbound', note: 'Link goes from source to target' })
    }
    return JSON.stringify({ direction: 'none' })
  },
})

/**
 * Tool to fetch Wikipedia page data
 */
export const fetchWikipediaPageDataTool = tool({
  name: 'fetch_wikipedia_page_data',
  description: 'Fetch full text extract and categories for a Wikipedia page by its page ID.',
  parameters: {
    type: 'object',
    properties: {
      pageId: {
        type: 'number',
        description: 'The Wikipedia page ID to fetch data for',
      },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  async execute({ pageId }: { pageId: number }) {
    try {
      const result = await fetchWikipediaPageData(pageId)
      return JSON.stringify(result)
    } catch (error: any) {
      return JSON.stringify({ error: error.message, extract: '', fullText: '', categories: [], title: '' })
    }
  },
})

/**
 * Tool to get relationship edges between pages
 */
export const getRelationshipEdgesTool = tool({
  name: 'get_relationship_edges',
  description: 'Get all edges (links) between a set of page IDs from the database.',
  parameters: {
    type: 'object',
    properties: {
      pageIds: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of page IDs to get edges between',
      },
    },
    required: ['pageIds'],
    additionalProperties: false,
  },
  async execute({ pageIds }: { pageIds: number[] }) {
    const { data } = await supabase
      .from('links')
      .select('from_page_id, to_page_id')
      .in('from_page_id', pageIds)
      .in('to_page_id', pageIds)

    const edges = (data || []).map((e: any) => ({
      from: e.from_page_id,
      to: e.to_page_id,
    }))
    return JSON.stringify(edges)
  },
})

/**
 * Tool to get page details from the database
 */
export const getPageDetailsTool = tool({
  name: 'get_page_details',
  description: 'Get basic page information (title, degrees) from the database for a set of page IDs.',
  parameters: {
    type: 'object',
    properties: {
      pageIds: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of page IDs to get details for',
      },
    },
    required: ['pageIds'],
    additionalProperties: false,
  },
  async execute({ pageIds }: { pageIds: number[] }) {
    const { data } = await supabase
      .from('pages')
      .select('page_id, title, out_degree, in_degree')
      .in('page_id', pageIds)

    const pages = (data || []).map((p: any) => ({
      page_id: p.page_id,
      title: p.title,
      out_degree: p.out_degree,
      in_degree: p.in_degree,
    }))
    return JSON.stringify(pages)
  },
})

