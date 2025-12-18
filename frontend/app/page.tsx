'use client'

import { useState, useEffect, useRef } from 'react'
import GraphVisualization from '@/components/GraphVisualization'
import { fetchEgoGraph, fetchAllGraph, searchPages } from '@/lib/api'

export default function Home() {
  const [graphData, setGraphData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageId, setPageId] = useState<string>('')
  const [selectedNode, setSelectedNode] = useState<any>(null)
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const loadGraph = async (id: string) => {
    if (!id.trim()) return
    
    setLoading(true)
    setError(null)
    try {
      const data = await fetchEgoGraph(parseInt(id), 500)
      setGraphData(data)
      setPageId(id)
      // Set selected node
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

  const handleNodeClick = async (pageId: number) => {
    setLoading(true)
    setError(null)
    try {
      // Fetch 1-hop ego graph for the clicked node
      const newGraphData = await fetchEgoGraph(pageId, 500)
      setGraphData(newGraphData)
      setPageId(pageId.toString())
      
      // Update selected node
      const centerNode = newGraphData.nodes.find((n: any) => n.page_id === pageId)
      setSelectedNode(centerNode || null)
    } catch (err: any) {
      setError(err.message || 'Failed to load node graph')
    } finally {
      setLoading(false)
    }
  }

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
    loadGraph(result.page_id.toString())
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
    } catch (err: any) {
      setError(err.message || 'Failed to load all graph')
      setGraphData(null)
      setSelectedNode(null)
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
          <GraphVisualization data={displayGraphData} onNodeClick={handleNodeClick} />
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
      {selectedNode && (
        <div className="absolute top-20 right-6 w-80 bg-[#121420]/95 backdrop-blur-sm border border-[#22263a] rounded-lg shadow-2xl z-40 overflow-hidden">
          <div className="p-6 space-y-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
            {/* Node Title */}
            <div>
              <h2 className="text-xl font-bold text-[#eaf0ff] mb-2">{selectedNode.title}</h2>
              
              {/* Metadata */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#eaf0ff]/60">Page ID:</span>
                  <span className="text-[#eaf0ff]">{selectedNode.page_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#eaf0ff]/60">Out Degree:</span>
                  <span className="text-[#eaf0ff]">{selectedNode.out_degree}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#eaf0ff]/60">In Degree:</span>
                  <span className="text-[#eaf0ff]">{selectedNode.in_degree}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#eaf0ff]/60">Total Connections:</span>
                  <span className="text-[#eaf0ff]">{selectedNode.out_degree + selectedNode.in_degree}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </main>
  )
}

