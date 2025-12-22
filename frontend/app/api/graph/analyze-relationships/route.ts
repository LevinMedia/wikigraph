import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { run, setDefaultOpenAIKey } from '@openai/agents'
import { fetchWikipediaPageData } from './wiki-utils'
import { createRelationshipAnalyzerAgent, buildAgentContext } from './agent'

// Server-side Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseAnonKey)

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

    // Step 5: Get page titles for context
    // Ensure pages_data is available
    if (!pages_data || pages_data.length === 0) {
      return NextResponse.json(
        { error: 'No page data available for analysis' },
        { status: 400 }
      )
    }
    
    const centerTitle = pages_data.find((p) => p.page_id === centerPageId)?.title || 'Unknown'
    const selectedTitle = pages_data.find((p) => p.page_id === selectedNodeId)?.title || 'Unknown'

    // Step 6: Build initial context with actual page content
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

    // Step 7: Create agent and build context
    const agent = createRelationshipAnalyzerAgent(centerTitle, selectedTitle, additionalRelationships)
    const contextText = buildAgentContext(
      centerPageId,
      selectedNodeId,
      centerTitle,
      selectedTitle,
      linkDirection,
      pagesContext,
      additionalRelationships
    )

    // Step 8: Build input
    let input: string
    if (followUpQuestion) {
      // For follow-up questions, include the cluster context so the agent has all the page data
      input = `${contextText}\n\nFOLLOW-UP QUESTION: ${followUpQuestion}\n\nUse the cluster page data provided above to answer this question. Reference specific facts from the page extracts.`
    } else {
      input = contextText
    }

    // Step 9: Run the agent
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

