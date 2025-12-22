import { Agent } from '@openai/agents'
import {
  getLinkDirectionTool,
  fetchWikipediaPageDataTool,
  getPageDetailsTool,
} from './tools'

/**
 * Creates and configures the relationship analyzer agent
 */
export function createRelationshipAnalyzerAgent(
  centerTitle: string,
  selectedTitle: string,
  additionalRelationships: Array<{ page_id: number; title: string }>
): Agent {
  return new Agent({
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
}

/**
 * Builds the context text for the agent
 */
export function buildAgentContext(
  centerPageId: number,
  selectedNodeId: number,
  centerTitle: string,
  selectedTitle: string,
  linkDirection: 'inbound' | 'outbound' | 'bidirectional',
  pagesContext: string,
  additionalRelationships: Array<{ page_id: number; title: string }>
): string {
  // Link direction context
  let linkContext = `LINK DIRECTION: ${linkDirection}\n`
  if (linkDirection === 'inbound') {
    linkContext += `The link goes FROM "${selectedTitle}" TO "${centerTitle}" (inbound to center).\n`
    linkContext += `This means "${selectedTitle}" links to "${centerTitle}" in its content.\n`
  } else if (linkDirection === 'outbound') {
    linkContext += `The link goes FROM "${centerTitle}" TO "${selectedTitle}" (outbound from center).\n`
    linkContext += `This means "${centerTitle}" links to "${selectedTitle}" in its content.\n`
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

  return contextText
}

