'use client'

import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { analyzeRelationships, AnalyzeRelationshipsResponse } from '@/lib/api'
import { requireSupabase } from '@/lib/supabase'

interface RelationshipAnalyzerProps {
  isOpen: boolean
  onClose: () => void
  centerPageId: number
  selectedNodeId: number | null
  centerTitle?: string
  selectedTitle?: string
}

export default function RelationshipAnalyzer({
  isOpen,
  onClose,
  centerPageId,
  selectedNodeId,
  centerTitle,
  selectedTitle,
}: RelationshipAnalyzerProps) {
  const [analysis, setAnalysis] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: string; content: string }>>([])
  const [followUpQuestion, setFollowUpQuestion] = useState('')
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false)
  const [clusterSize, setClusterSize] = useState<number | null>(null)
  const [sampled, setSampled] = useState(false)
  const [analyzingPages, setAnalyzingPages] = useState<string[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const rotationIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [analysis])

  // Rotate through analyzing pages
  useEffect(() => {
    if (analyzingPages.length > 0 && loading) {
      rotationIntervalRef.current = setInterval(() => {
        setCurrentPageIndex((prev) => (prev + 1) % analyzingPages.length)
      }, 1500)
      
      return () => {
        if (rotationIntervalRef.current) {
          clearInterval(rotationIntervalRef.current)
          rotationIntervalRef.current = null
        }
      }
    } else {
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current)
        rotationIntervalRef.current = null
      }
    }
  }, [analyzingPages, loading])

  // Fetch initial analysis when drawer opens
  useEffect(() => {
    if (isOpen && selectedNodeId && !analysis && !loading && !conversationId) {
      // Reset conversation when opening with a new node
      setConversationHistory([])
      fetchAnalysis()
    }
  }, [isOpen, selectedNodeId])

  const fetchAnalysis = async () => {
    if (!selectedNodeId) return

    setLoading(true)
    setError(null)
    setAnalysis('')
    setCurrentPageIndex(0)

    // Fetch cluster page titles for the loading animation
    try {
      const db = requireSupabase()
      
      // Get all first-degree neighbors of center
      const { data: centerLinks } = await db
        .from('links')
        .select('from_page_id, to_page_id')
        .or(`from_page_id.eq.${centerPageId},to_page_id.eq.${centerPageId}`)

      const firstDegreeIds = new Set<number>()
      centerLinks?.forEach((link: any) => {
        if (link.from_page_id === centerPageId) firstDegreeIds.add(link.to_page_id)
        if (link.to_page_id === centerPageId) firstDegreeIds.add(link.from_page_id)
      })

      // Get all first-degree nodes connected to selected node that also connect to center
      const clusterNodeIds = new Set<number>([centerPageId, selectedNodeId])

      const { data: selectedLinks } = await db
        .from('links')
        .select('from_page_id, to_page_id')
        .or(`from_page_id.eq.${selectedNodeId},to_page_id.eq.${selectedNodeId}`)

      selectedLinks?.forEach((link: any) => {
        const otherId = link.from_page_id === selectedNodeId ? link.to_page_id : link.from_page_id
        if (firstDegreeIds.has(otherId)) {
          clusterNodeIds.add(otherId)
        }
      })

      // Get page titles
      const clusterIdsArray = Array.from(clusterNodeIds)
      const { data: pagesData } = await db
        .from('pages')
        .select('page_id, title')
        .in('page_id', clusterIdsArray)

      const pageTitles = (pagesData || [])
        .map((p: any) => p.title)
        .filter((title: string) => title && title.trim() !== '')
        .slice(0, 20) // Limit to 20 for display

      setAnalyzingPages(pageTitles)
      setClusterSize(clusterNodeIds.size)
    } catch (err) {
      console.error('Error fetching cluster pages:', err)
      setAnalyzingPages([])
    }

    try {
      const response: AnalyzeRelationshipsResponse = await analyzeRelationships(
        centerPageId,
        selectedNodeId,
        conversationId || undefined,
        undefined,
        conversationHistory.length > 0 ? conversationHistory : undefined
      )

      // Clear rotation interval
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current)
        rotationIntervalRef.current = null
      }
      
      setAnalysis(response.analysis)
      setConversationId(response.conversation_id)
      setClusterSize(response.cluster_size)
      setSampled(response.sampled)
      setAnalyzingPages([])
      
      // Update conversation history with the response
      setConversationHistory((prev) => [
        ...prev,
        { role: 'assistant', content: response.analysis },
      ])
    } catch (err: any) {
      // Clear rotation interval
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current)
        rotationIntervalRef.current = null
      }
      setError(err.message || 'Failed to analyze relationships')
      setAnalyzingPages([])
    } finally {
      setLoading(false)
    }
  }

  const handleFollowUp = async () => {
    if (!followUpQuestion.trim() || !conversationId || !selectedNodeId) return

    setIsSubmittingFollowUp(true)
    setError(null)

    const question = followUpQuestion.trim()
    
    try {
      // Add user question to history
      const updatedHistory = [
        ...conversationHistory,
        { role: 'user', content: question },
      ]
      
      const response: AnalyzeRelationshipsResponse = await analyzeRelationships(
        centerPageId,
        selectedNodeId,
        conversationId || undefined,
        question,
        updatedHistory
      )

      // Append follow-up Q&A to analysis
      setAnalysis((prev) => {
        const newAnalysis = prev + '\n\n**Q:** ' + question + '\n\n**A:** ' + response.analysis
        return newAnalysis
      })
      
      // Update conversation history
      setConversationHistory([
        ...updatedHistory,
        { role: 'assistant', content: response.analysis },
      ])
      
      setFollowUpQuestion('')
    } catch (err: any) {
      setError(err.message || 'Failed to submit follow-up question')
    } finally {
      setIsSubmittingFollowUp(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleFollowUp()
    }
  }

  // Reset when drawer closes
  useEffect(() => {
    if (!isOpen) {
      // Don't reset analysis - keep it for when drawer reopens
      // setAnalysis('')
      // setConversationId(null)
      setError(null)
      setFollowUpQuestion('')
      // Clear rotation interval
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current)
        rotationIntervalRef.current = null
      }
    }
  }, [isOpen])

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current)
      }
    }
  }, [])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 transition-opacity"
        onClick={onClose}
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      />

      {/* Drawer */}
      <div
        className="fixed inset-0 z-50 flex flex-col bg-[#0a0d14] text-[#eaf0ff] transition-transform duration-300 ease-out"
        style={{
          transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#22263a]">
          <div>
            <h2 className="text-2xl font-bold text-[#4ecdc4]">Relationship Analysis</h2>
            {centerTitle && selectedTitle && (
              <p className="text-sm text-[#8b9dc3] mt-1">
                Analyzing connections around <span className="font-semibold">{selectedTitle}</span> relative to{' '}
                <span className="font-semibold">{centerTitle}</span>
              </p>
            )}
            {clusterSize !== null && (
              <p className="text-xs text-[#6b7a99] mt-1">
                Cluster size: {clusterSize} {sampled && '(sampled)'}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#8b9dc3] hover:text-[#eaf0ff] transition-colors p-2"
            aria-label="Close"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
          {loading && !analysis && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4ecdc4] mx-auto mb-4"></div>
                <p className="text-[#8b9dc3] mb-2">Analyzing pages in cluster:</p>
                {analyzingPages.length > 0 ? (
                  <p className="text-[#4ecdc4] font-semibold text-lg min-h-[28px] transition-opacity duration-500">
                    {analyzingPages[currentPageIndex] || analyzingPages[0]}
                  </p>
                ) : (
                  <p className="text-[#8b9dc3]">Loading cluster...</p>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 mb-4">
              <p className="text-red-400">{error}</p>
              <button
                onClick={fetchAnalysis}
                className="mt-2 text-sm text-red-400 hover:text-red-300 underline"
              >
                Retry
              </button>
            </div>
          )}

          {analysis && (
            <div className="flex justify-center">
              <div className="prose prose-invert max-w-[640px] w-full text-[#eaf0ff] leading-relaxed">
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-3xl font-bold text-[#4ecdc4] mt-10 mb-5">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-2xl font-bold text-[#4ecdc4] mt-8 mb-4">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-xl font-bold text-[#8b9dc3] mt-6 mb-3">{children}</h3>
                    ),
                    p: ({ children }) => (
                      <p className="mb-3 text-[#eaf0ff]">{children}</p>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-bold text-[#4ecdc4]">{children}</strong>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc list-outside mb-3 text-[#eaf0ff] ml-6 space-y-2">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal list-outside mb-3 text-[#eaf0ff] ml-6 space-y-2">{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className="text-[#eaf0ff] leading-relaxed">{children}</li>
                    ),
                    code: ({ children }) => (
                      <code className="bg-[#0f1120] px-2 py-1 rounded text-[#4ecdc4] text-sm">{children}</code>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-[#4ecdc4] pl-4 italic text-[#8b9dc3] my-4">
                        {children}
                      </blockquote>
                    ),
                  }}
                >
                  {analysis}
                </ReactMarkdown>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Footer with follow-up input */}
        {analysis && conversationId && (
          <div className="border-t border-[#22263a] p-4">
            <div className="flex gap-2">
              <textarea
                value={followUpQuestion}
                onChange={(e) => setFollowUpQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a follow-up question... (Press Enter to submit)"
                className="flex-1 bg-[#0f1120] border border-[#22263a] rounded-lg px-4 py-2 text-[#eaf0ff] placeholder-[#6b7a99] focus:outline-none focus:border-[#4ecdc4] resize-none"
                rows={2}
                disabled={isSubmittingFollowUp}
              />
              <button
                onClick={handleFollowUp}
                disabled={!followUpQuestion.trim() || isSubmittingFollowUp}
                className="px-6 py-2 bg-[#4ecdc4] text-[#0a0d14] rounded-lg font-semibold hover:bg-[#3db8b0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmittingFollowUp ? 'Sending...' : 'Ask'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

