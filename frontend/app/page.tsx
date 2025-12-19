'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Switch } from '@headlessui/react'
import GraphVisualization from '@/components/GraphVisualization'
import { fetchEgoGraph, fetchAllGraph, searchPages } from '@/lib/api'

export default function Home() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [graphData, setGraphData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageId, setPageId] = useState<string>('')
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [selectedNodeIdFromList, setSelectedNodeIdFromList] = useState<number | null>(null)
  
  // Relationship type filters
  const [showTwoWay, setShowTwoWay] = useState(true)
  const [showOutbound, setShowOutbound] = useState(true)
  const [showInbound, setShowInbound] = useState(true)
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const loadGraph = async (id: string, updateUrl: boolean = true) => {
    if (!id.trim()) return
    
    setLoading(true)
    setError(null)
    try {
      // Update URL if requested (but not when loading from URL)
      if (updateUrl) {
        router.push(`/?page=${id}`, { scroll: false })
      }
      
      const data = await fetchEgoGraph(parseInt(id), 500)
      setGraphData(data)
      setPageId(id)
      // Set selected node
      const centerNode = data.nodes.find((n: any) => n.is_center)
      setSelectedNode(centerNode || null)
      // Clear list selection when graph changes
      setSelectedNodeIdFromList(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load graph')
      setGraphData(null)
      setSelectedNode(null)
      setSelectedNodeIdFromList(null)
    } finally {
      setLoading(false)
    }
  }

  const handleNodeClick = async (pageId: number) => {
    setLoading(true)
    setError(null)
    try {
      // Update URL with the new page ID
      router.push(`/?page=${pageId}`, { scroll: false })
      
      // Fetch 1-hop ego graph for the clicked node
      const newGraphData = await fetchEgoGraph(pageId, 500)
      setGraphData(newGraphData)
      setPageId(pageId.toString())
      
      // Update selected node
      const centerNode = newGraphData.nodes.find((n: any) => n.page_id === pageId)
      setSelectedNode(centerNode || null)
      // Clear list selection when graph changes
      setSelectedNodeIdFromList(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load node graph')
    } finally {
      setLoading(false)
    }
  }
  
  // Load graph from URL on mount or when URL changes
  useEffect(() => {
    const urlPageId = searchParams.get('page')
    if (urlPageId && urlPageId !== pageId) {
      // Load from URL without updating URL again
      const loadFromUrl = async () => {
        setLoading(true)
        setError(null)
        try {
          const data = await fetchEgoGraph(parseInt(urlPageId), 500)
          setGraphData(data)
          setPageId(urlPageId)
          const centerNode = data.nodes.find((n: any) => n.is_center)
          setSelectedNode(centerNode || null)
        } catch (err: any) {
          setError(err.message || 'Failed to load graph')
          setGraphData(null)
          setSelectedNode(null)
        } finally {
          setLoading(false)
        }
      }
      loadFromUrl()
    }
  }, [searchParams, pageId])

  // Search functionality
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      setShowResults(false)
      return
    }
    
    setIsSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchPages(searchQuery, 10)
        setSearchResults(results)
        setShowResults(true)
        setSelectedIndex(-1)
      } catch (error) {
        console.error('Search failed:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
    
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node) &&
        resultsRef.current &&
        !resultsRef.current.contains(event.target as Node)
      ) {
        setShowResults(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const handleSelectResult = (result: any) => {
    setSearchQuery(result.title)
    setShowResults(false)
    loadGraph(result.page_id.toString(), true) // Update URL when searching
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || searchResults.length === 0) return
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => 
        prev < searchResults.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => prev > 0 ? prev - 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
        handleSelectResult(searchResults[selectedIndex])
      } else if (searchResults.length > 0) {
        handleSelectResult(searchResults[0])
      }
    } else if (e.key === 'Escape') {
      setShowResults(false)
    }
  }
  
  const displayGraphData = graphData

  const loadAllGraph = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAllGraph(1000)
      setGraphData(data)
      setPageId('')
      // Set selected node to the center
      const centerNode = data.nodes.find((n: any) => n.is_center)
      setSelectedNode(centerNode || null)
      // Clear list selection when graph changes
      setSelectedNodeIdFromList(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load all graph')
      setGraphData(null)
      setSelectedNode(null)
      setSelectedNodeIdFromList(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen w-screen flex flex-col overflow-hidden bg-[#0a0b14] relative">
      {/* Floating Header */}
      <header className="absolute top-0 left-0 right-0 z-50 px-6 py-4 pointer-events-none">
        <div className="flex items-center justify-between">
          {/* Title on left */}
          <h1 className="text-2xl font-bold text-[#eaf0ff] pointer-events-auto">WGE</h1>
          
          {/* Centered Search Bar */}
          <div className="absolute left-1/2 transform -translate-x-1/2 pointer-events-auto">
            <div className="relative w-96">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleKeyDown}
                onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
                placeholder="Search Wikipedia pages..."
                className="w-full px-4 py-2 bg-[#0b0c10]/90 backdrop-blur-sm border border-[#2b3050] rounded-lg text-[#eaf0ff] placeholder:text-[#eaf0ff]/40 focus:outline-none focus:border-[#4ecdc4]"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-[#4ecdc4] border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              
              {/* Search Results Dropdown */}
              {showResults && searchResults.length > 0 && (
                <div
                  ref={resultsRef}
                  className="absolute z-50 w-full mt-1 bg-[#0b0c10] border border-[#2b3050] rounded-lg shadow-lg max-h-64 overflow-y-auto"
                  style={{ top: '100%' }}
                >
                  {searchResults.map((result, index) => (
                    <div
                      key={result.page_id}
                      onClick={() => handleSelectResult(result)}
                      className={`px-4 py-2 cursor-pointer hover:bg-[#1b2040] border-b border-[#22263a] last:border-b-0 ${
                        index === selectedIndex ? 'bg-[#1b2040]' : ''
                      }`}
                    >
                      <div className="text-[#eaf0ff] font-medium">{result.title}</div>
                      <div className="text-xs text-[#eaf0ff]/60 mt-1">
                        ID: {result.page_id} · out={result.out_degree} in={result.in_degree}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {showResults && searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
                <div className="absolute z-50 w-full mt-1 bg-[#0b0c10] border border-[#2b3050] rounded-lg shadow-lg p-4 text-[#eaf0ff]/60 text-sm">
                  No pages found
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Graph Area - Full Screen */}
      <div className="flex-1 relative w-full h-full">
        {displayGraphData ? (
          <GraphVisualization 
            data={displayGraphData} 
            onNodeClick={handleNodeClick}
            onNodeSelect={(nodeId) => setSelectedNodeIdFromList(nodeId)}
            relationshipFilters={{
              showTwoWay,
              showOutbound,
              showInbound
            }}
            externalSelectedNodeId={selectedNodeIdFromList}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-[#eaf0ff]/60 mb-4">
                {loading ? 'Loading graph...' : 'Search for a Wikipedia page to visualize'}
              </p>
              {error && (
                <p className="text-red-400 text-sm mb-4">{error}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Info Panel */}
      {selectedNode && graphData && (() => {
        // Calculate relationships list
        const nodeId = selectedNode.page_id
        const edges = graphData.edges || []
        const nodes = graphData.nodes || []
        
        // Create a map of node IDs to node objects for quick lookup
        const nodeMap = new Map(nodes.map((n: any) => [n.page_id, n]))
        
        // Get all unique connected node IDs
        const connectedNodeIds = new Set<number>()
        edges.forEach((e: any) => {
          if (e.from === nodeId) {
            connectedNodeIds.add(e.to)
          }
          if (e.to === nodeId) {
            connectedNodeIds.add(e.from)
          }
        })
        
        // Build relationship list with type information
        const relationships = Array.from(connectedNodeIds).map((connectedId: number) => {
          const connectedNode = nodeMap.get(connectedId)
          const hasOutbound = edges.some((e: any) => e.from === nodeId && e.to === connectedId)
          const hasInbound = edges.some((e: any) => e.to === nodeId && e.from === connectedId)
          
          let relationshipType = ''
          if (hasOutbound && hasInbound) {
            relationshipType = 'Two way'
          } else if (hasOutbound) {
            relationshipType = 'Outbound'
          } else if (hasInbound) {
            relationshipType = 'Inbound'
          }
          
          return {
            nodeId: connectedId,
            title: connectedNode?.title || `Page ${connectedId}`,
            type: relationshipType
          }
        })
        
        // Sort relationships: two-way first, then inbound, then outbound, then alphabetically by title
        relationships.sort((a, b) => {
          const typeOrder: { [key: string]: number } = { 'Two way': 0, 'Inbound': 1, 'Outbound': 2 }
          const aOrder = typeOrder[a.type] ?? 999
          const bOrder = typeOrder[b.type] ?? 999
          const typeDiff = aOrder - bOrder
          if (typeDiff !== 0) return typeDiff
          return a.title.localeCompare(b.title)
        })
        
        return (
          <div className="absolute top-20 right-6 w-80 bg-[#121420]/95 backdrop-blur-sm border border-[#22263a] rounded-lg shadow-2xl z-40 overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
            <div className="p-6 flex-shrink-0">
              {/* Node Title */}
              <div>
                <h2 className="text-xl font-bold text-[#eaf0ff] mb-2">{selectedNode.title}</h2>
                
                {/* Metadata */}
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#eaf0ff]/60">Page ID:</span>
                    <span className="text-[#eaf0ff]">{selectedNode.page_id}</span>
                  </div>
                  
                  {/* Relationship Filters */}
                  <div className="pt-2 border-t border-[#22263a] pb-3">
                    <div className="text-sm font-medium text-[#eaf0ff] mb-2">
                      Show Relationships
                    </div>
                    <div className="space-y-2">
                      <Switch.Group>
                        <div className="flex items-center justify-between">
                          <Switch.Label className="text-sm text-[#eaf0ff]/80 cursor-pointer">
                            Two way
                          </Switch.Label>
                          <Switch
                            checked={showTwoWay}
                            onChange={setShowTwoWay}
                            className={`${
                              showTwoWay ? 'bg-[#4ecdc4]' : 'bg-[#2b3050]'
                            } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#4ecdc4] focus:ring-offset-2 focus:ring-offset-[#121420]`}
                          >
                            <span
                              className={`${
                                showTwoWay ? 'translate-x-6' : 'translate-x-1'
                              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                            />
                          </Switch>
                        </div>
                      </Switch.Group>
                      <Switch.Group>
                        <div className="flex items-center justify-between">
                          <Switch.Label className="text-sm text-[#eaf0ff]/80 cursor-pointer">
                            Inbound
                          </Switch.Label>
                          <Switch
                            checked={showInbound}
                            onChange={setShowInbound}
                            className={`${
                              showInbound ? 'bg-[#8b5cf6]' : 'bg-[#2b3050]'
                            } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#8b5cf6] focus:ring-offset-2 focus:ring-offset-[#121420]`}
                          >
                            <span
                              className={`${
                                showInbound ? 'translate-x-6' : 'translate-x-1'
                              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                            />
                          </Switch>
                        </div>
                      </Switch.Group>
                      <Switch.Group>
                        <div className="flex items-center justify-between">
                          <Switch.Label className="text-sm text-[#eaf0ff]/80 cursor-pointer">
                            Outbound
                          </Switch.Label>
                          <Switch
                            checked={showOutbound}
                            onChange={setShowOutbound}
                            className={`${
                              showOutbound ? 'bg-[#a78bfa]' : 'bg-[#2b3050]'
                            } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#a78bfa] focus:ring-offset-2 focus:ring-offset-[#121420]`}
                          >
                            <span
                              className={`${
                                showOutbound ? 'translate-x-6' : 'translate-x-1'
                              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                            />
                          </Switch>
                        </div>
                      </Switch.Group>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Relationships List - Scrollable */}
            <div className="px-6 pb-6 pt-2 border-t border-[#22263a] flex-1 overflow-hidden flex flex-col min-h-0">
              <div className="text-sm font-medium text-[#eaf0ff] mb-2 flex-shrink-0">
                Relationships ({relationships.length})
              </div>
              <div className="space-y-1 overflow-y-auto flex-1 min-h-0">
                {relationships.length === 0 ? (
                  <div className="text-sm text-[#eaf0ff]/60 py-2">No relationships</div>
                ) : (
                  relationships.map((rel, index) => {
                    const isSelected = selectedNodeIdFromList === rel.nodeId
                    return (
                      <div 
                        key={`${rel.nodeId}-${index}`}
                        onClick={() => {
                          // Toggle selection: if clicking the same node, deselect; otherwise select new node
                          setSelectedNodeIdFromList(isSelected ? null : rel.nodeId)
                        }}
                        className={`text-sm py-1.5 px-2 rounded hover:bg-[#1b2040]/50 border-b border-[#22263a]/50 last:border-b-0 cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#1b2040] border-l-2 border-l-[#4ecdc4]' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[#eaf0ff] flex-1 truncate">{rel.title}</span>
                          <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
                            rel.type === 'Two way' 
                              ? 'bg-[#4ecdc4]/20 text-[#4ecdc4]'
                              : rel.type === 'Inbound'
                              ? 'bg-[#8b5cf6]/20 text-[#8b5cf6]'
                              : 'bg-[#a78bfa]/20 text-[#a78bfa]'
                          }`}>
                            {rel.type}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </main>
  )
}

