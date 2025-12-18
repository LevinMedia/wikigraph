'use client'

import { useState, useEffect, useRef } from 'react'
import { fetchJobs, searchPages } from '@/lib/api'
import { supabase } from '@/lib/supabase'

interface ControlPanelProps {
  pageId: string
  onLoadGraph: (pageId: string) => void
  onLoadAllGraph: () => void
  loading: boolean
}

export default function ControlPanel({ pageId, onLoadGraph, onLoadAllGraph, loading }: ControlPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)

  // Debounced search
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
        console.log(`[ControlPanel] Searching for: "${searchQuery}"`)
        const results = await searchPages(searchQuery, 10)
        console.log(`[ControlPanel] Got ${results.length} results`)
        setSearchResults(results)
        setShowResults(true)
        setSelectedIndex(-1)
      } catch (error) {
        console.error('[ControlPanel] Search failed:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300) // 300ms debounce
    
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery])

  // Close results when clicking outside
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
    onLoadGraph(result.page_id.toString())
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


  const refreshJobs = async () => {
    setJobsLoading(true)
    try {
      const data = await fetchJobs()
      setJobs(data.jobs || [])
    } catch (err) {
      console.error('Failed to fetch jobs:', err)
    } finally {
      setJobsLoading(false)
    }
  }

  useEffect(() => {
    refreshJobs()
    
    // Subscribe to real-time updates on page_fetch table
    const db = supabase
    if (db) {
      const channel = db
        .channel('page_fetch_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'page_fetch',
          },
          () => {
            refreshJobs()
          }
        )
        .subscribe()

      return () => {
        db.removeChannel(channel)
      }
    }
  }, [])

  return (
    <div className="w-96 bg-[#121420] border-l border-[#22263a] overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Load Graph Section */}
        <section className="bg-[#0f1120] border border-[#22263a] rounded-lg p-4 relative">
          <h2 className="text-lg font-semibold text-[#eaf0ff] mb-3">Load Graph</h2>
          <div className="space-y-2">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleKeyDown}
                onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
                placeholder="Search Wikipedia pages..."
                className="w-full px-3 py-2 bg-[#0b0c10] border border-[#2b3050] rounded text-[#eaf0ff] placeholder:text-[#eaf0ff]/40 focus:outline-none focus:border-[#4ecdc4]"
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
            
            <div className="flex gap-2">
              <button
                onClick={onLoadAllGraph}
                disabled={loading}
                className="w-full px-4 py-2 bg-[#2b3050] hover:bg-[#333a66] border border-[#3b4266] rounded text-[#eaf0ff] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                title="Load all nodes and edges in the database"
              >
                {loading ? '...' : 'Load All Nodes'}
              </button>
            </div>
          </div>
        </section>

        {/* Info Section */}
        <section className="bg-[#0f1120] border border-[#22263a] rounded-lg p-4">
          <h2 className="text-lg font-semibold text-[#eaf0ff] mb-3">About</h2>
          <p className="text-sm text-[#eaf0ff]/60">
            This is a visualization tool. To enqueue pages for crawling, use the FastAPI dashboard at your backend URL.
          </p>
        </section>

        {/* Jobs Section */}
        <section className="bg-[#0f1120] border border-[#22263a] rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-[#eaf0ff]">Crawl Jobs</h2>
            <button
              onClick={refreshJobs}
              disabled={jobsLoading}
              className="px-3 py-1 text-sm bg-[#1b2040] hover:bg-[#232a55] border border-[#2b3050] rounded text-[#eaf0ff] disabled:opacity-50"
            >
              {jobsLoading ? '...' : 'Refresh'}
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {jobs.length === 0 ? (
              <p className="text-sm text-[#eaf0ff]/60">No jobs yet</p>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.page_id}
                  className="p-3 bg-[#0b0c10] border border-[#22263a] rounded text-sm"
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex-1">
                      <div className="text-[#eaf0ff] font-medium truncate">
                        {job.title}
                      </div>
                      <div className="text-[#eaf0ff]/60 text-xs mt-1">
                        ID: {job.page_id}
                      </div>
                    </div>
                    <span className="px-2 py-1 text-xs bg-[#1b2040] border border-[#2b3050] rounded text-[#eaf0ff]">
                      {job.status}
                    </span>
                  </div>
                  <div className="text-xs text-[#eaf0ff]/60 mt-2">
                    out={job.out_degree} · in={job.in_degree}
                    {job.last_error && (
                      <div className="text-red-400 mt-1 truncate">
                        Error: {job.last_error}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

