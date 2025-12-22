import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Agent, tool, run, setDefaultOpenAIKey } from '@openai/agents'

// Server-side Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper to fetch Wikipedia page data
async function fetchWikipediaPageData(pageId: number, fetchFullText: boolean = false): Promise<{ extract: string; fullText: string; categories: string[]; title: string }> {
  try {
    // First, get the page title from the API
    const titleUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=info&inprop=url&format=json&origin=*`
    
    // Wikipedia API requires User-Agent header for server-side requests
    const userAgent = process.env.WIKIPEDIA_USER_AGENT || 
      'WikiGraphExplorer/1.0 (https://github.com/yourusername/wikiGraph; contact@example.com)'
    
    const headers = {
      'User-Agent': userAgent,
      'Accept': 'application/json',
    }
    
    // Get title first
    const titleRes = await fetch(titleUrl, { headers })
    if (!titleRes.ok || !titleRes.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`Wikipedia API returned non-JSON response for title`)
    }
    const titleData = await titleRes.json()
    const title = titleData.query?.pages?.[pageId]?.title || ''
    
    if (!title) {
      throw new Error(`Could not get title for page ${pageId}`)
    }
    
    // Fetch intro extract (for quick context)
    const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=extracts&exintro=true&explaintext=true&format=json&origin=*`
    
    // Fetch RAW wikitext (complete page content including all tables) - this is the key!
    const rawTextUrl: string | null = fetchFullText
      ? `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`
      : null
    
    const categoriesUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=categories&cllimit=50&format=json&origin=*`

    const fetchPromises = [
      fetch(extractUrl, { headers }),
      fetch(categoriesUrl, { headers }),
    ]
    
    if (rawTextUrl) {
      // Raw wikitext is plain text, not JSON
      fetchPromises.push(fetch(rawTextUrl, { headers: { 'User-Agent': userAgent } }))
    }
    
    const results = await Promise.all(fetchPromises)
    const extractRes = results[0]
    const categoriesRes = results[1]
    const rawTextRes = rawTextUrl ? results[2] : null

    // Check if responses are OK
    if (!extractRes.ok || !extractRes.headers.get('content-type')?.includes('application/json')) {
      const text = await extractRes.text()
      console.error(`Wikipedia API error for extract (page ${pageId}):`, text.substring(0, 200))
      throw new Error(`Wikipedia API returned non-JSON response for extract`)
    }

    if (rawTextRes && !rawTextRes.ok) {
      const text = await rawTextRes.text()
      console.error(`Wikipedia API error for raw text (page ${pageId}):`, text.substring(0, 200))
      throw new Error(`Wikipedia API returned error for raw text`)
    }

    if (!categoriesRes.ok || !categoriesRes.headers.get('content-type')?.includes('application/json')) {
      const text = await categoriesRes.text()
      console.error(`Wikipedia API error for categories (page ${pageId}):`, text.substring(0, 200))
      throw new Error(`Wikipedia API returned non-JSON response for categories`)
    }

    const extractData = await extractRes.json()
    const rawText: string | null = rawTextRes ? await rawTextRes.text() : null
    const categoriesData = await categoriesRes.json()

    const page = extractData.query?.pages?.[pageId]
    const categories = categoriesData.query?.pages?.[pageId]?.categories || []

    // Use raw wikitext if available, otherwise fall back to extract
    const fullText: string = rawText || ''
    
    // Debug logging for content inspection
    if (fullText && fullText.length > 0) {
      console.log(`[DEBUG fetchWikipediaPageData] Page ${pageId} (${title}) fullText length:`, fullText.length)
      console.log(`[DEBUG fetchWikipediaPageData] Using raw wikitext:`, !!rawText)
      // Check for common table indicators
      console.log(`[DEBUG fetchWikipediaPageData] Contains "Episode":`, fullText.includes('Episode'))
      console.log(`[DEBUG fetchWikipediaPageData] Contains "Season":`, fullText.includes('Season'))
      console.log(`[DEBUG fetchWikipediaPageData] Contains "Broadcast Date":`, fullText.includes('Broadcast Date'))
      console.log(`[DEBUG fetchWikipediaPageData] Contains "Tanner Hall":`, fullText.includes('Tanner Hall'))
      console.log(`[DEBUG fetchWikipediaPageData] Contains "Chad's Gap":`, fullText.includes("Chad's Gap"))
      console.log(`[DEBUG fetchWikipediaPageData] Contains "wikitable":`, fullText.includes('wikitable'))
      // Sample a section that should contain Episode 17
      const episode17Index = fullText.indexOf('Episode 17') || fullText.indexOf('|17')
      if (episode17Index > 0) {
        console.log(`[DEBUG fetchWikipediaPageData] Episode 17 section sample:`, fullText.substring(episode17Index, episode17Index + 2000))
      }
    } else {
      console.warn(`[DEBUG fetchWikipediaPageData] Page ${pageId} (${title}) has NO fullText!`)
    }

    return {
      extract: page?.extract || '',
      fullText: fullText, // Full page text including tables (only if fullText=true)
      categories: categories.map((c: any) => c.title.replace('Category:', '')),
      title: title || '',
    }
  } catch (error: any) {
    console.error(`Error fetching Wikipedia data for page ${pageId}:`, error)
    return { extract: '', fullText: '', categories: [], title: '' }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      centerPageId,
      selectedNodeId,
      conversationId,
      followUpQuestion,
      conversationHistory,
    } = body

    if (!centerPageId || !selectedNodeId) {
      return NextResponse.json(
        { error: 'centerPageId and selectedNodeId are required' },
        { status: 400 }
      )
    }

    // Check for OpenAI API key (server-side, no NEXT_PUBLIC_ prefix)
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not set on server. Please add it to your .env.local file.' },
        { status: 500 }
      )
    }

    // Set the default API key for the SDK
    setDefaultOpenAIKey(openaiApiKey)

    // Step 1: Get direct link between center and selected node
    const { data: directLinks } = await supabase
      .from('links')
      .select('from_page_id, to_page_id')
      .or(`and(from_page_id.eq.${centerPageId},to_page_id.eq.${selectedNodeId}),and(from_page_id.eq.${selectedNodeId},to_page_id.eq.${centerPageId})`)

    // Determine link direction
    let linkDirection: 'inbound' | 'outbound' | 'bidirectional' = 'bidirectional'
    const hasCenterToSelected = directLinks?.some((l: any) => l.from_page_id === centerPageId && l.to_page_id === selectedNodeId)
    const hasSelectedToCenter = directLinks?.some((l: any) => l.from_page_id === selectedNodeId && l.to_page_id === centerPageId)
    
    if (hasCenterToSelected && hasSelectedToCenter) {
      linkDirection = 'bidirectional'
    } else if (hasSelectedToCenter) {
      linkDirection = 'inbound' // Link FROM selected TO center (center receives link)
    } else if (hasCenterToSelected) {
      linkDirection = 'outbound' // Link FROM center TO selected (center links to selected)
    }

    // Step 2: Get page titles from Supabase (fallback) - we'll update pageIdsToFetch after finding additional relationships
    const initialPageIds = [centerPageId, selectedNodeId]
    const { data: pagesData } = await supabase
      .from('pages')
      .select('page_id, title')
      .in('page_id', initialPageIds)

    const pagesMap = new Map<number, { title: string }>()
    pagesData?.forEach((p: any) => {
      pagesMap.set(p.page_id, { title: p.title })
    })

    // Step 3: Find additional relationships (nodes that are 1st-degree of BOTH center and selected)
    // Get all first-degree neighbors of center
    const { data: centerLinks } = await supabase
      .from('links')
      .select('from_page_id, to_page_id')
      .or(`from_page_id.eq.${centerPageId},to_page_id.eq.${centerPageId}`)
    
    const centerFirstDegreeIds = new Set<number>()
    centerLinks?.forEach((link: any) => {
      if (link.from_page_id === centerPageId) centerFirstDegreeIds.add(link.to_page_id)
      if (link.to_page_id === centerPageId) centerFirstDegreeIds.add(link.from_page_id)
    })
    
    // Get all first-degree neighbors of selected node
    const { data: selectedLinks } = await supabase
      .from('links')
      .select('from_page_id, to_page_id')
      .or(`from_page_id.eq.${selectedNodeId},to_page_id.eq.${selectedNodeId}`)
    
    const selectedFirstDegreeIds = new Set<number>()
    selectedLinks?.forEach((link: any) => {
      if (link.from_page_id === selectedNodeId) selectedFirstDegreeIds.add(link.to_page_id)
      if (link.to_page_id === selectedNodeId) selectedFirstDegreeIds.add(link.from_page_id)
    })
    
    // Find intersection: nodes that are 1st-degree of BOTH center and selected
    const additionalRelationshipIds = Array.from(centerFirstDegreeIds).filter(
      (id) => selectedFirstDegreeIds.has(id) && id !== centerPageId && id !== selectedNodeId
    )
    
    console.log(`[DEBUG] Found ${additionalRelationshipIds.length} additional relationships (1st-degree of both center and selected)`)
    
    // Fetch titles for additional relationships
    const additionalRelationships: Array<{ page_id: number; title: string }> = []
    if (additionalRelationshipIds.length > 0) {
      const { data: additionalPages } = await supabase
        .from('pages')
        .select('page_id, title')
        .in('page_id', additionalRelationshipIds)
      
      if (additionalPages) {
        additionalRelationships.push(...additionalPages.map((p: any) => ({
          page_id: p.page_id,
          title: p.title,
        })))
      }
    }
    
    console.log(`[DEBUG] Additional relationships:`, additionalRelationships.map(r => r.title))

    // Now build the full list of page IDs to fetch (center, selected, and additional relationships)
    const pageIdsToFetch = [centerPageId, selectedNodeId, ...additionalRelationshipIds]
    const clusterSize = pageIdsToFetch.length
    const sampled = false

    // Step 4: Fetch Wikipedia data - full text for center, selected, AND additional relationships
    const wikiData = new Map<number, { extract: string; fullText: string; categories: string[]; title: string }>()
    for (const pageId of pageIdsToFetch) {
      try {
        // Always fetch full text for both center and selected nodes
        const data = await fetchWikipediaPageData(pageId, true)
        wikiData.set(pageId, data)
        
        // Debug: Log content length and sample for the selected node
        if (pageId === selectedNodeId) {
          console.log(`[DEBUG] Selected node (${data.title}) fullText length:`, data.fullText.length)
          console.log(`[DEBUG] Selected node fullText sample (first 2000 chars):`, data.fullText.substring(0, 2000))
          console.log(`[DEBUG] Selected node fullText contains "Tanner Hall":`, data.fullText.includes('Tanner Hall'))
          console.log(`[DEBUG] Selected node fullText contains "Chad\'s Gap":`, data.fullText.includes("Chad's Gap"))
          console.log(`[DEBUG] Selected node fullText contains "Episode 17":`, data.fullText.includes('Episode 17'))
        }
        if (pageId === centerPageId) {
          console.log(`[DEBUG] Center node (${data.title}) fullText length:`, data.fullText.length)
          console.log(`[DEBUG] Center node fullText sample (first 2000 chars):`, data.fullText.substring(0, 2000))
        }
      } catch (error) {
        console.warn(`Failed to fetch Wikipedia data for page ${pageId}:`, error)
        const page = pagesMap.get(pageId)
        if (page) {
          wikiData.set(pageId, { extract: '', fullText: '', categories: [], title: page.title })
        }
      }
    }

    // Build pages_data list
    const pages_data = pageIdsToFetch
      .map((pageId) => {
        const data = wikiData.get(pageId)
        if (!data) return null
        return {
          page_id: pageId,
          title: data.title,
          extract: data.extract,
          fullText: data.fullText,
          categories: data.categories,
        }
      })
      .filter((p) => p !== null) as Array<{ page_id: number; title: string; extract: string; fullText: string; categories: string[] }>

    // Step 4: Get link information tool
    const getLinkDirectionTool = tool({
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

    // Step 5: Define tools
    const fetchWikipediaPageDataTool = tool({
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

    const getRelationshipEdgesTool = tool({
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

    const getPageDetailsTool = tool({
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
          total_degree: (p.out_degree || 0) + (p.in_degree || 0),
        }))
        return JSON.stringify(pages)
      },
    })

    // Step 6: Get page titles for context
    // Ensure pages_data is available
    if (!pages_data || pages_data.length === 0) {
      return NextResponse.json(
        { error: 'No page data available for analysis' },
        { status: 400 }
      )
    }
    
    const centerTitle = pages_data.find((p) => p.page_id === centerPageId)?.title || 'Unknown'
    const selectedTitle = pages_data.find((p) => p.page_id === selectedNodeId)?.title || 'Unknown'

    // Step 7: Create agent
    const agent = new Agent({
      name: 'Wikipedia Relationship Analyzer',
      instructions: `You are analyzing the DIRECT relationship between two Wikipedia pages. Your task is to find the explicit connection between them in their page content.

CRITICAL INSTRUCTIONS:
1. You have COMPLETE, UNTRUNCATED page content for BOTH pages. The full text includes ALL tables, lists, episode lists, sections, and every piece of content.
2. The link direction tells you WHERE to look for the connection:
   - If "inbound": The selected node ("${selectedTitle}") links TO the center node ("${centerTitle}"). Look in "${selectedTitle}"'s FULL content for mentions of "${centerTitle}".
   - If "outbound": The center node ("${centerTitle}") links TO the selected node ("${selectedTitle}"). Look in "${centerTitle}"'s FULL content for mentions of "${selectedTitle}".
   - If "bidirectional": Both pages link to each other. Check both.
3. Search through EVERYTHING: tables, episode tables, lists, all sections, footnotes, references - the connection IS there in the full content.
4. For episode tables or event lists: Look for entries that mention the other page's subject. The connection might be in a table row, list item, or structured data.
5. Find the SPECIFIC mention or reference that creates the link. Quote the exact text or table entry.
6. Structure your response EXACTLY as requested in the context.
7. When searching for additional relationships in episode tables: You MUST read through EVERY single episode from Episode 1 to the last episode. Do not skip any. If searching for a location like "Park City, Utah" and you don't find it, you haven't searched thoroughly enough - it IS there, you must find it.

IMPORTANT: The full page content is provided with NO truncation. If you don't see a connection, search more carefully through tables and structured data. The connection exists because there's a database link between these pages. When searching episode tables, read through ALL episodes systematically - do not stop early.`,
      model: 'gpt-4o',
      tools: [fetchWikipediaPageDataTool, getLinkDirectionTool, getPageDetailsTool],
    })

    // Step 8: Build initial context with actual page content
    const centerPage = pages_data.find((p) => p.page_id === centerPageId)
    const selectedPage = pages_data.find((p) => p.page_id === selectedNodeId)

    if (!centerPage || !selectedPage) {
      return NextResponse.json(
        { error: 'Could not fetch page data for center or selected node' },
        { status: 400 }
      )
    }

    // Build context with FULL page content for both nodes (no truncation)
    let pagesContext = `PAGE DATA:\n\n`
    
    pagesContext += `--- ${selectedPage.title} (Selected Node, Page ID: ${selectedNodeId}) ---\n`
    if (selectedPage.fullText) {
      // Include COMPLETE page content - no truncation
      console.log(`[DEBUG] Including selected page fullText (length: ${selectedPage.fullText.length})`)
      pagesContext += `Full Content:\n${selectedPage.fullText}\n`
    } else if (selectedPage.extract) {
      console.log(`[DEBUG] Selected page has no fullText, using extract (length: ${selectedPage.extract.length})`)
      pagesContext += `Extract:\n${selectedPage.extract}\n`
    } else {
      console.warn(`[DEBUG] Selected page has no content!`)
    }
    if (selectedPage.categories && selectedPage.categories.length > 0) {
      pagesContext += `Categories: ${selectedPage.categories.join(', ')}\n`
    }
    pagesContext += '\n'
    
    pagesContext += `--- ${centerPage.title} (Key Node/Center, Page ID: ${centerPageId}) ---\n`
    if (centerPage.fullText) {
      // Include COMPLETE page content - no truncation
      console.log(`[DEBUG] Including center page fullText (length: ${centerPage.fullText.length})`)
      pagesContext += `Full Content:\n${centerPage.fullText}\n`
    } else if (centerPage.extract) {
      console.log(`[DEBUG] Center page has no fullText, using extract (length: ${centerPage.extract.length})`)
      pagesContext += `Extract:\n${centerPage.extract}\n`
    } else {
      console.warn(`[DEBUG] Center page has no content!`)
    }
    if (centerPage.categories && centerPage.categories.length > 0) {
      pagesContext += `Categories: ${centerPage.categories.join(', ')}\n`
    }
    pagesContext += '\n'
    
    // Add additional relationships page content
    if (additionalRelationships.length > 0) {
      pagesContext += `--- Additional Relationships (1st-degree of both "${centerPage.title}" and "${selectedPage.title}") ---\n\n`
      for (const rel of additionalRelationships) {
        const relData = wikiData.get(rel.page_id)
        if (relData) {
          pagesContext += `--- ${relData.title} (Page ID: ${rel.page_id}) ---\n`
          if (relData.fullText) {
            pagesContext += `Full Content:\n${relData.fullText}\n`
          } else if (relData.extract) {
            pagesContext += `Extract:\n${relData.extract}\n`
          }
          if (relData.categories && relData.categories.length > 0) {
            pagesContext += `Categories: ${relData.categories.join(', ')}\n`
          }
          pagesContext += '\n'
        }
      }
    }
    
    // Debug: Log context size
    console.log(`[DEBUG] Total pagesContext length: ${pagesContext.length} characters`)
    console.log(`[DEBUG] Context preview (first 500 chars):`, pagesContext.substring(0, 500))

    // Link direction context
    let linkContext = `LINK DIRECTION: ${linkDirection}\n`
    if (linkDirection === 'inbound') {
      linkContext += `The link goes FROM "${selectedPage.title}" TO "${centerPage.title}" (inbound to center).\n`
      linkContext += `This means "${selectedPage.title}" links to "${centerPage.title}" in its content.\n`
    } else if (linkDirection === 'outbound') {
      linkContext += `The link goes FROM "${centerPage.title}" TO "${selectedPage.title}" (outbound from center).\n`
      linkContext += `This means "${centerPage.title}" links to "${selectedPage.title}" in its content.\n`
    } else {
      linkContext += `The link is bidirectional - both pages link to each other.\n`
    }

    let contextText = `You are analyzing the DIRECT relationship between two Wikipedia pages:
- Key Node (Center): "${centerTitle}" (page ID: ${centerPageId})
- Selected Node: "${selectedTitle}" (page ID: ${selectedNodeId})

${linkContext}

${pagesContext}

YOUR TASK: Find the EXPLICIT connection between these two pages in their content. The connection EXISTS because there's a database link. Search thoroughly:

- The link direction is: ${linkDirection}
- If inbound: Search "${selectedTitle}"'s COMPLETE content (including ALL tables) for "${centerTitle}"
- If outbound: Search "${centerTitle}"'s COMPLETE content (including ALL tables) for "${selectedTitle}"
- Look in episode tables, event lists, notable events sections, and ALL structured data
- The full page content is provided with NO truncation - search everything

ADDITIONAL RELATIONSHIPS:
${additionalRelationships.length > 0 
  ? `The following ${additionalRelationships.length} page(s) are first-degree relationships of BOTH "${centerTitle}" and "${selectedTitle}" (they connect to both pages):
${additionalRelationships.map(r => `- ${r.title} (page ID: ${r.page_id})`).join('\n')}

The FULL page content (raw wikitext) for each of these additional relationship pages is provided below. 

CRITICAL: To find how each additional relationship page connects to both "${centerTitle}" and "${selectedTitle}", you must:

1. Search "${centerTitle}"'s COMPLETE page content (including ALL episodes, tables, lists, and sections) for explicit mentions of the additional relationship page. Search EVERY episode, not just the first one you find.

2. Search "${selectedTitle}"'s COMPLETE page content (including ALL episodes, tables, lists, and sections) for explicit mentions of the additional relationship page. Search EVERY episode, not just the first one you find.

3. Check the additional relationship page's content for explicit mentions of "${centerTitle}" or "${selectedTitle}"

IMPORTANT: When searching episode tables or lists:
- The page content is in Wikipedia wikitext format. Episode tables use wikitext table syntax:
  - Tables start with "{|" and end with "|}"
  - Rows are separated by "|-"
  - Table cells use "|" for data and "!" for headers
  - Episode numbers appear in cells like "|26" or "|-\n|26"
  - Episode descriptions are in list format with "#" bullets within table rows
- You MUST read through ALL episodes systematically from Episode 1 to the last episode. Do not skip any episodes.
- Look for the additional relationship page name in EVERY single episode description. Search for both "[[Page Name]]" (wikitext link format) and "Page Name" (plain text).
- When searching for any location, person, or entity name, check ALL episodes - mentions can appear in any episode, not just early ones.
- If you don't find a mention after searching all episodes, go back and check EVERY episode again more carefully, paying attention to the wikitext table structure. The mention may be in a later episode.
- Cite the specific episode number, broadcast date, and description where the connection appears (e.g., "Episode 26, August 8, 2008: [Page Name] (Date) - description text")

For example, if "${centerTitle}"'s page mentions a location and "${selectedTitle}"'s page also mentions that same location in ANY episode, then that location connects to both. You must find and cite ALL mentions, not just the first one.

Only report connections that you can explicitly see in the raw page content - cite the specific episode number, table entry, text, or section where the connection appears.`
  : 'No additional relationships found (no pages are first-degree connections of both the center and selected nodes).'
}

STRUCTURE YOUR RESPONSE EXACTLY AS FOLLOWS:

**${selectedTitle}**
- Key details about this page (2-3 sentences)
- Notable facts, categories, or context

**${centerTitle}**
- Key details about this page (2-3 sentences)
- Notable facts, categories, or context

**Primary Relationship**
- Explicit connection found in the page content
- Specific details about how they're related (mention tables, sections, or specific text where the connection appears)
- Additional context or color about the relationship

${additionalRelationships.length > 0 ? `**Additional Relationships**

First, provide a bulleted list with one sentence description for each additional relationship page:

${additionalRelationships.map(r => `- **${r.title}**: [One sentence describing how this page explicitly connects to both "${centerTitle}" and "${selectedTitle}". You MUST cite specific mentions with episode numbers or section names: e.g., "${centerTitle}'s page mentions ${r.title} in [specific section]" and "${selectedTitle}'s page mentions ${r.title} in Episode X (Date) about [description]".]`).join('\n')}

For each additional relationship, you MUST:
- Search "${centerTitle}"'s COMPLETE page content (ALL tables, ALL sections) for explicit mentions of the additional relationship page. Cite the specific episode number, section, or text where it appears.
- Search "${selectedTitle}"'s COMPLETE page content (ALL tables, ALL sections) for explicit mentions of the additional relationship page. You must check EVERY episode in the episode table, not just the first few. Cite the specific episode number, broadcast date, and description (e.g., "Episode X, Date: [Page Name] - description").
- Check if the additional relationship page explicitly mentions "${centerTitle}" or "${selectedTitle}"

CRITICAL: When searching episode tables, you must read through ALL episodes systematically from the first episode to the last. Do not skip any episodes. Do not stop after finding one mention - there may be multiple episodes that mention the same location or person. 

VERY IMPORTANT: If you claim that a page is not mentioned in "${selectedTitle}"'s episode table, you must have searched through EVERY single episode from Episode 1 to the final episode. If you haven't checked all episodes, you cannot conclude that a mention doesn't exist. Go through the episode table line by line, checking every single episode description before concluding that a mention is absent.

CRITICAL: Only report on EXPLICIT connections that you can see in the raw page content provided. Cite specific text, table entries, or sections. Do not infer, assume, or speculate about connections that aren't explicitly stated in the page text, tables, or structured data. Do NOT provide narrative paragraphs summarizing the relationships - only the bulleted list is needed.` : ''}

Be specific and reference actual content from the pages. Look in tables, lists, and all sections of the full page content.`

    // Step 8: Build input
    let input: string
    if (followUpQuestion) {
      // For follow-up questions, include the cluster context so the agent has all the page data
      input = `${contextText}\n\nFOLLOW-UP QUESTION: ${followUpQuestion}\n\nUse the cluster page data provided above to answer this question. Reference specific facts from the page extracts.`
    } else {
      input = contextText
    }

    // Step 10: Run the agent
    const result = await run(agent, input)

    // Debug: Log key properties
    console.log('[analyze-relationships] Result keys:', Object.keys(result || {}))
    console.log('[analyze-relationships] finalOutput:', result?.finalOutput)
    console.log('[analyze-relationships] newItems count:', result?.newItems?.length)
    const state = result?.state as any
    if (state?.messages) {
      console.log('[analyze-relationships] Messages count:', state.messages.length)
      console.log('[analyze-relationships] Last 3 messages:', JSON.stringify(state.messages.slice(-3), null, 2))
    }

    // Extract the analysis from the result
    // The result may have finalOutput, newItems, or state.messages
    let analysis = 'No analysis generated.'
    
    // First, check for finalOutput (most direct)
    if (result?.finalOutput) {
      if (typeof result.finalOutput === 'string') {
        analysis = result.finalOutput
      } else if (typeof result.finalOutput === 'object' && result.finalOutput !== null) {
        const finalOutputAny = result.finalOutput as any
        if ('text' in finalOutputAny && finalOutputAny.text) {
          analysis = String(finalOutputAny.text)
        } else if ('content' in finalOutputAny && finalOutputAny.content) {
          analysis = typeof finalOutputAny.content === 'string' ? finalOutputAny.content : JSON.stringify(finalOutputAny.content)
        }
      }
    }
    
    // If no finalOutput, check newItems for text messages
    if (analysis === 'No analysis generated.' && result?.newItems && Array.isArray(result.newItems)) {
      for (let i = result.newItems.length - 1; i >= 0; i--) {
        const item = result.newItems[i] as any
        if (item && typeof item === 'object') {
          if (item.type === 'message_output_item' && item.content) {
            if (typeof item.content === 'string') {
              analysis = item.content
              break
            } else if (Array.isArray(item.content)) {
              for (const block of item.content) {
                if (typeof block === 'string') {
                  analysis = block
                  break
                } else if (block && typeof block === 'object' && 'text' in block) {
                  analysis = String((block as any).text)
                  break
                }
              }
              if (analysis !== 'No analysis generated.') break
            }
          }
        }
      }
    }
    
    // Fallback: check state.messages
    if (analysis === 'No analysis generated.' && result && typeof result === 'object') {
      // Check if result has a state object
      const resultAny = result as any
      if ('state' in resultAny && resultAny.state) {
        const state = resultAny.state as any
        
        // Check for messages in state
        if ('messages' in state && Array.isArray(state.messages)) {
          // Find the last assistant message
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const msg = state.messages[i]
            if (msg && typeof msg === 'object') {
              // Check for assistant role (try various role names)
              const role = msg.role || msg.type || ''
              // Look for assistant messages (not user messages)
              if (role === 'assistant' || role === 'AI' || role === 'agent') {
                // Try different content structures
                if (msg.content) {
                  if (typeof msg.content === 'string') {
                    analysis = msg.content
                    break
                  } else if (typeof msg.content === 'object' && 'text' in msg.content) {
                    analysis = msg.content.text
                    break
                  } else if (Array.isArray(msg.content)) {
                    // Content might be an array of content blocks
                    for (const block of msg.content) {
                      if (typeof block === 'string') {
                        analysis = block
                        break
                      } else if (block && typeof block === 'object' && 'text' in block) {
                        analysis = block.text
                        break
                      }
                    }
                    if (analysis !== 'No analysis generated.') break
                  }
                } else if (msg.text && typeof msg.text === 'string') {
                  analysis = msg.text
                  break
                }
              }
            }
          }
        }
        
        // Also check modelResponses for output
        if (analysis === 'No analysis generated.' && 'modelResponses' in state && Array.isArray(state.modelResponses)) {
          // Get the last model response
          const lastResponse = state.modelResponses[state.modelResponses.length - 1]
          if (lastResponse && 'output' in lastResponse && Array.isArray(lastResponse.output)) {
            // Look for text output in the response
            for (const output of lastResponse.output) {
              if (output && typeof output === 'object') {
                if (output.type === 'text' && output.text) {
                  analysis = output.text
                  break
                } else if (output.content && typeof output.content === 'string') {
                  analysis = output.content
                  break
                }
              }
            }
          }
        }
        
        // Check for output_text in state
        if (analysis === 'No analysis generated.' && 'output_text' in state && state.output_text) {
          analysis = String(state.output_text)
        }
        
        // Check for text in state
        if (analysis === 'No analysis generated.' && 'text' in state && state.text) {
          analysis = String(state.text)
        }
      }
      
      // Fallback: check for direct properties
      if (analysis === 'No analysis generated.') {
        const resultAny = result as any
        if ('output_text' in resultAny && resultAny.output_text) {
          analysis = String(resultAny.output_text)
        } else if ('text' in resultAny && resultAny.text) {
          analysis = String(resultAny.text)
        } else if ('content' in resultAny && resultAny.content) {
          analysis = typeof resultAny.content === 'string' ? resultAny.content : JSON.stringify(resultAny.content)
        } else if ('messages' in resultAny && Array.isArray(resultAny.messages)) {
          for (let i = resultAny.messages.length - 1; i >= 0; i--) {
            const msg = resultAny.messages[i]
            if (msg && typeof msg === 'object' && (msg.role === 'assistant' || msg.role === 'AI' || msg.role === 'agent')) {
              if (msg.content && typeof msg.content === 'string') {
                analysis = msg.content
                break
              }
            }
          }
        }
      }
    } else if (typeof result === 'string') {
      analysis = result
    }
    
    console.log('[analyze-relationships] Extracted analysis length:', analysis.length)
    console.log('[analyze-relationships] Analysis preview:', analysis.substring(0, 200))

    // Generate conversation ID if not provided
    const newConversationId = conversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    return NextResponse.json({
      analysis: analysis.trim(),
      conversationId: newConversationId,
      conversation_id: newConversationId, // Also include for compatibility
      cluster_size: clusterSize,
      sampled,
    })
  } catch (error: any) {
    console.error('Error in analyze-relationships API route:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to analyze relationships' },
      { status: 500 }
    )
  }
}

