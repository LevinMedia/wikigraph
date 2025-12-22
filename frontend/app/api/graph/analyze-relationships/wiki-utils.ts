/**
 * Helper to fetch Wikipedia page data
 */
export async function fetchWikipediaPageData(pageId: number, fetchFullText: boolean = false): Promise<{ extract: string; fullText: string; categories: string[]; title: string }> {
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

