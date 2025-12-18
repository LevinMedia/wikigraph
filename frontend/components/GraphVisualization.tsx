'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import { GraphNode, GraphEdge } from '@/lib/api'

interface GraphVisualizationProps {
  data: {
    center_page_id: number
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
  onNodeClick?: (pageId: number) => void
}

// Billboard text component that always faces camera and maintains consistent screen size
function BillboardText({ children, position, fontSize, ...props }: any) {
  const ref = useRef<THREE.Group>(null)
  const { camera, size } = useThree()
  
  useFrame(() => {
    if (ref.current) {
      ref.current.lookAt(camera.position)
      
      // Scale text to maintain consistent screen size (14px) regardless of distance
      const distance = camera.position.distanceTo(ref.current.position)
      // Calculate scale to maintain ~14px on screen
      // For a camera at distance 25 with fov 50, we want text to appear ~14px
      // Using: scale = (desiredPixelSize / canvasHeight) * distance * tan(fov/2) * 2
      const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50
      const desiredPixelSize = 14
      const scale = (desiredPixelSize / size.height) * distance * Math.tan((fov * Math.PI / 180) / 2) * 2
      ref.current.scale.set(scale, scale, scale)
    }
  })
  
  return (
    <group ref={ref} position={position}>
      <Text
        fontSize={fontSize}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000000"
        {...props}
      >
        {children}
      </Text>
    </group>
  )
}

function GraphNode3D({ 
  node, 
  position, 
  onNodeClick,
  onNodePageClick,
  isHighlighted,
  onHover,
  onNodeSelect,
  onDragStart,
  onDragEnd,
  showLabel,
  onPointerDownCapture,
  isDragged,
  isDraggingGlobal
}: { 
  node: GraphNode
  position: [number, number, number]
  onNodeClick: (position: [number, number, number]) => void
  onNodePageClick?: (pageId: number) => void
  isHighlighted?: boolean
  onHover?: (pageId: number | null) => void
  onNodeSelect?: (pageId: number) => void
  onDragStart?: (pageId: number) => void
  onDragEnd?: (pageId: number) => void
  showLabel?: boolean
  onPointerDownCapture?: (pageId: number) => void
  isDragged?: boolean
  isDraggingGlobal?: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const hasDraggedRef = useRef(false)
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null)
  
  // Use global dragging state if provided, otherwise use local
  const isDraggingActive = isDraggingGlobal ?? isDragging
  
  // Size based on degree (log scale for better visualization)
  const totalDegree = node.out_degree + node.in_degree
  const size = Math.max(0.15, Math.min(1.2, Math.log10(totalDegree + 1) / 2.5))
  
  // Color: center node always stays red, hovered/dragged node is light yellow, others change when highlighted
  // Highlight if hovered or isHighlighted
  const isHighlightedNode = hovered || isHighlighted
  const color = node.is_center
    ? '#ff6b6b' // Center node always red
    : (hovered || isDragged)
      ? '#fef08a' // Hovered or dragged node is light yellow
      : isHighlightedNode
        ? '#ffffff' // Highlighted nodes are white
        : node.in_degree > node.out_degree 
          ? '#4ecdc4' 
          : '#95e1d3'
  
  // Note: isDraggingActive is used to prevent hover updates, but color uses hovered/isDragged

  return (
    <group position={position}>
      <mesh 
        ref={meshRef}
        onPointerOver={() => {
          // Don't update hover state if we're dragging - keep it locked
          if (!isDraggingActive) {
            setHovered(true)
            if (onHover) onHover(node.page_id)
          }
        }}
        onPointerOut={() => {
          // Don't update hover state if we're dragging - keep it locked
          if (!isDraggingActive) {
            setHovered(false)
            if (onHover) {
              onHover(null)
            }
          }
        }}
        onPointerDown={(e) => {
          e.stopPropagation() // Prevent canvas click from firing
          setIsDragging(false)
          hasDraggedRef.current = false
          // Capture pointer position to detect drag
          pointerDownPosRef.current = { x: e.clientX, y: e.clientY }
          // Capture the currently hovered node when pointer goes down
          // This happens before click, so we can use it in the click handler
          if (onPointerDownCapture) {
            onPointerDownCapture(node.page_id)
          }
          // Notify parent that this node is being dragged
          if (onDragStart) {
            onDragStart(node.page_id)
          }
        }}
        onPointerMove={(e) => {
          // Detect if we're actually dragging (pointer moved significantly)
          if (pointerDownPosRef.current && !hasDraggedRef.current) {
            const dx = e.clientX - pointerDownPosRef.current.x
            const dy = e.clientY - pointerDownPosRef.current.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            // If moved more than 5 pixels, consider it a drag
            if (distance > 5) {
              hasDraggedRef.current = true
            }
          }
        }}
        onPointerUp={(e) => {
          e.stopPropagation()
          setIsDragging(false)
          pointerDownPosRef.current = null
          if (onDragEnd) {
            onDragEnd(node.page_id)
          }
        }}
        onClick={(e) => {
          e.stopPropagation()
          // Only handle click if we didn't drag
          if (!hasDraggedRef.current) {
            // Single click - persist the current hover highlights
            // Use the ref value (which should still have the hovered node) or the clicked node
            if (onNodeSelect) {
              // The ref should still have the value from when we were hovering
              // If not, use the clicked node itself
              onNodeSelect(node.page_id)
            }
          }
          // Reset drag flag after click
          hasDraggedRef.current = false
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          // Double click - switch view to this node
          if (onNodePageClick && !hasDraggedRef.current) {
            onNodePageClick(node.page_id)
          }
        }}
      >
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial 
          color={color} 
          emissive={color} 
          emissiveIntensity={isHighlightedNode ? 0.6 : 0.2}
        />
      </mesh>
      {(node.is_center || hovered || showLabel || isDragged) && (
        <BillboardText
          position={[0, size + 0.3, 0]}
          fontSize={1.0}
          color="#eaf0ff"
        >
          {node.title}
        </BillboardText>
      )}
    </group>
  )
}

// Force-directed layout with variable edge lengths
function calculateNodePositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerPageId: number
): Map<number, [number, number, number]> {
  const positions = new Map<number, [number, number, number]>()
  
  // Center node at origin
  const centerNode = nodes.find(n => n.page_id === centerPageId)
  if (centerNode) {
    positions.set(centerPageId, [0, 0, 0])
  }
  
  // Build adjacency map
  const adjacency = new Map<number, Set<number>>()
  nodes.forEach(n => adjacency.set(n.page_id, new Set()))
  edges.forEach(e => {
    adjacency.get(e.from)?.add(e.to)
    adjacency.get(e.to)?.add(e.from)
  })
  
  // Get first-degree neighbors (directly connected to center)
  const firstDegree = new Set<number>()
  const centerNeighbors = adjacency.get(centerPageId) || new Set()
  centerNeighbors.forEach(id => firstDegree.add(id))
  
  // Position first-degree neighbors in a sphere around center
  const firstDegreeArray = Array.from(firstDegree)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const baseRadius = 10
  
  firstDegreeArray.forEach((nodeId, index) => {
    const node = nodes.find(n => n.page_id === nodeId)
    if (!node) return
    
    const totalDegree = node.out_degree + node.in_degree
    const radius = baseRadius + Math.log10(totalDegree + 1) * 1.5
    
    const theta = goldenAngle * index
    const y = firstDegreeArray.length > 1 ? 1 - (index / (firstDegreeArray.length - 1)) * 2 : 0
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y))
    
    const x = radiusAtY * Math.cos(theta) * radius
    const z = radiusAtY * Math.sin(theta) * radius
    const yPos = y * radius
    
    positions.set(nodeId, [x, yPos, z])
  })
  
  // Ensure ALL nodes get positions (fallback for any nodes not yet positioned)
  nodes.forEach(node => {
    if (!positions.has(node.page_id)) {
      // Position unconnected nodes in a sphere further out
      const index = nodes.indexOf(node)
      const totalNodes = nodes.length
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))
      const theta = goldenAngle * index
      const y = totalNodes > 1 ? 1 - (index / (totalNodes - 1)) * 2 : 0
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y))
      const radius = 25 + Math.log10(node.out_degree + node.in_degree + 1) * 2
      
      const x = radiusAtY * Math.cos(theta) * radius
      const z = radiusAtY * Math.sin(theta) * radius
      const yPos = y * radius
      
      positions.set(node.page_id, [x, yPos, z])
    }
  })
  
  return positions
}

// Component to track drag state on the canvas
function DragTracker({ onDragStart, onDragEnd }: { onDragStart: () => void; onDragEnd: () => void }) {
  const { gl } = useThree()
  const isDraggingRef = useRef(false)
  
  useEffect(() => {
    const canvas = gl.domElement
    
    const handlePointerDown = (e: PointerEvent) => {
      // Only track if it's not a click on a node (which would be handled by the node itself)
      if (e.button === 0) { // Left mouse button
        isDraggingRef.current = true
        onDragStart()
      }
    }
    
    const handlePointerMove = () => {
      if (isDraggingRef.current) {
        // Already started, keep it going
      }
    }
    
    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        onDragEnd()
      }
    }
    
    // Use capture phase to catch events before they reach nodes
    canvas.addEventListener('pointerdown', handlePointerDown, true)
    canvas.addEventListener('pointermove', handlePointerMove, true)
    canvas.addEventListener('pointerup', handlePointerUp, true)
    canvas.addEventListener('pointercancel', handlePointerUp, true)
    
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, true)
      canvas.removeEventListener('pointermove', handlePointerMove, true)
      canvas.removeEventListener('pointerup', handlePointerUp, true)
      canvas.removeEventListener('pointercancel', handlePointerUp, true)
    }
  }, [gl, onDragStart, onDragEnd])
  
  return null
}

// Camera animator - animates camera to center on clicked node
function CameraAnimator({ 
  targetPosition
}: { 
  targetPosition: [number, number, number]
}) {
  const { camera } = useThree()
  const startPosRef = useRef<THREE.Vector3 | null>(null)
  const startTargetRef = useRef<THREE.Vector3 | null>(null)
  const endTargetRef = useRef<THREE.Vector3 | null>(null)
  const endPosRef = useRef<THREE.Vector3 | null>(null)
  const startTimeRef = useRef<number>(0)
  const controlsRef = useRef<any>(null)
  const isCompleteRef = useRef(false)
  
  useEffect(() => {
    isCompleteRef.current = false
    const [x, y, z] = targetPosition
    const endTarget = new THREE.Vector3(x, y, z)
    
    startPosRef.current = camera.position.clone()
    endTargetRef.current = endTarget
    
    // Find OrbitControls from the canvas
    const canvas = document.querySelector('canvas')
    if (canvas) {
      const r3f = (canvas as any).__r3f
      if (r3f?.root) {
        const state = r3f.root.getState()
        if (state.controls) {
          controlsRef.current = state.controls
          startTargetRef.current = state.controls.target.clone()
        }
      }
    }
    
    if (!startTargetRef.current) {
      startTargetRef.current = new THREE.Vector3(0, 0, 0)
    }
    
    // Calculate desired camera position - maintain same distance
    const currentTarget = startTargetRef.current
    const currentDistance = camera.position.distanceTo(currentTarget)
    
    // Direction from current target to camera
    const direction = new THREE.Vector3()
      .subVectors(camera.position, currentTarget)
      .normalize()
    
    // If direction is invalid, use default
    if (direction.length() < 0.1) {
      direction.set(0, 0, 1)
    }
    
    // New camera position maintains same distance from new target
    endPosRef.current = endTarget.clone().add(direction.multiplyScalar(currentDistance))
    
    startTimeRef.current = Date.now()
  }, [targetPosition, camera])
  
  useFrame(() => {
    if (isCompleteRef.current) return
    if (!startPosRef.current || !endPosRef.current || !endTargetRef.current) return
    if (!controlsRef.current) return
    
    const elapsed = Date.now() - startTimeRef.current
    const duration = 800
    const progress = Math.min(elapsed / duration, 1)
    
    // Easing function (ease-in-out cubic)
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2
    
    // Animate camera position
    camera.position.lerpVectors(startPosRef.current!, endPosRef.current!, eased)
    
    // Animate controls target
    controlsRef.current.target.lerpVectors(startTargetRef.current!, endTargetRef.current!, eased)
    controlsRef.current.update()
    
    if (progress >= 1) {
      isCompleteRef.current = true
    }
  })
  
  return null
}

export default function GraphVisualization({ data, onNodeClick }: GraphVisualizationProps) {
  const { nodes, edges } = data
  const [targetPosition, setTargetPosition] = useState<[number, number, number] | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [lockedHoveredNodeId, setLockedHoveredNodeId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  // Use ref to track hovered node so it doesn't get lost when pointer out fires before click
  const hoveredNodeIdRef = useRef<number | null>(null)
  // Capture hovered node on pointer down (like we do for drag)
  const clickedHoveredNodeIdRef = useRef<number | null>(null)
  // Track which node is being dragged (clicked and held)
  const [draggedNodeId, setDraggedNodeId] = useState<number | null>(null)
  
  // Calculate node positions using force-directed layout
  const nodePositions = useMemo(() => {
    console.log(`[GraphVisualization] Calculating positions for ${nodes.length} nodes, ${edges.length} edges, center=${data.center_page_id}`)
    const positions = calculateNodePositions(nodes, edges, data.center_page_id)
    console.log(`[GraphVisualization] Calculated ${positions.size} positions`)
    // Verify all nodes have positions
    nodes.forEach(node => {
      if (!positions.has(node.page_id)) {
        console.warn(`[GraphVisualization] Node ${node.page_id} (${node.title}) has no position!`)
      }
    })
    return positions
  }, [nodes, edges, data.center_page_id])

  const handleNodeClick = (position: [number, number, number]) => {
    setTargetPosition(position)
    setIsAnimating(true)
    setTimeout(() => {
      setIsAnimating(false)
      setTargetPosition(null)
    }, 1000)
  }
  
  const handleNodePageClick = (pageId: number) => {
    // Set selected node to persist highlights
    setSelectedNodeId(pageId)
    if (onNodeClick) {
      onNodeClick(pageId)
    }
  }
  
  const handleCanvasClick = () => {
    // Clear selected node when clicking on canvas (but not on a node)
    // This deselects everything when clicking outside the yellow node
    setSelectedNodeId(null)
    setDraggedNodeId(null)
    setLockedHoveredNodeId(null)
  }

  // Priority: selected node > locked hovered node (during drag) > current hovered node
  // Use useMemo to ensure this recalculates when dependencies change
  const activeHoveredNodeId = useMemo(() => {
    return selectedNodeId ?? (isDragging ? lockedHoveredNodeId : hoveredNodeId)
  }, [selectedNodeId, isDragging, lockedHoveredNodeId, hoveredNodeId])
  
  // Debug logging
  useEffect(() => {
    console.log('[GraphVisualization] State update - selected:', selectedNodeId, 'hovered:', hoveredNodeId, 'active:', activeHoveredNodeId)
  }, [selectedNodeId, hoveredNodeId, activeHoveredNodeId])

  // Helper: Check if a node is highlighted
  const isNodeHighlighted = (nodeId: number): boolean => {
    if (activeHoveredNodeId === null) return false
    if (nodeId === activeHoveredNodeId) return true
    
    const isConnectedToHovered = edges.some(e => 
      (e.from === activeHoveredNodeId && e.to === nodeId) ||
      (e.to === activeHoveredNodeId && e.from === nodeId)
    )
    const isConnectedToCenter = edges.some(e =>
      (e.from === data.center_page_id && e.to === nodeId) ||
      (e.to === data.center_page_id && e.from === nodeId)
    )
    
    // Highlight if connected to hovered node, OR if it's a shared connection (connected to both center and hovered)
    return isConnectedToHovered || (isConnectedToCenter && isConnectedToHovered && nodeId !== data.center_page_id)
  }

  return (
    <Canvas 
      camera={{ position: [0, 0, 25], fov: 50 }}
      onClick={handleCanvasClick}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <pointLight position={[-10, -10, -10]} color="#4ecdc4" />
      
      {/* Edges - all edges between any nodes */}
      {edges.map((edge) => {
        const fromPos = nodePositions.get(edge.from)
        const toPos = nodePositions.get(edge.to)
        if (!fromPos || !toPos) return null
        
        // Edge is highlighted if:
        // 1. It's directly connected to the hovered node, OR
        // 2. It connects a highlighted node to the center node
        const isConnectedToHovered = activeHoveredNodeId !== null && 
          (edge.from === activeHoveredNodeId || edge.to === activeHoveredNodeId)
        
        const fromIsHighlighted = activeHoveredNodeId !== null && isNodeHighlighted(edge.from)
        const toIsHighlighted = activeHoveredNodeId !== null && isNodeHighlighted(edge.to)
        const connectsHighlightedToCenter = (fromIsHighlighted && edge.to === data.center_page_id) ||
          (toIsHighlighted && edge.from === data.center_page_id)
        
        const isHighlightedEdge = isConnectedToHovered || connectsHighlightedToCenter
        
        // Lower contrast by default, higher contrast when highlighted
        const edgeColor = isHighlightedEdge ? '#60a5fa' : '#4a5568'
        const edgeOpacity = isHighlightedEdge ? 0.9 : 0.3
        
        return (
          <line key={`edge-${edge.from}-${edge.to}-${data.center_page_id}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([...fromPos, ...toPos])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial 
              color={edgeColor} 
              opacity={edgeOpacity}
              transparent={true}
            />
          </line>
        )
      })}
      
      {/* Nodes */}
      {nodes.map((node) => {
        const pos = nodePositions.get(node.page_id)
        if (!pos) {
          console.warn(`[GraphVisualization] Node ${node.page_id} (${node.title}) has no position, skipping render`)
          return null
        }
        
        // Use the same highlighting logic as edges
        const isHighlighted = isNodeHighlighted(node.page_id)
        
        // Show label if: center node, or first-degree connection of active hovered node
        const showLabel = node.is_center || (
          activeHoveredNodeId !== null && 
          node.page_id !== activeHoveredNodeId &&
          edges.some(e => 
            (e.from === activeHoveredNodeId && e.to === node.page_id) ||
            (e.to === activeHoveredNodeId && e.from === node.page_id)
          )
        )
        
        return (
          <GraphNode3D 
            key={`${node.page_id}-${data.center_page_id}`} 
            node={node} 
            position={pos}
            onNodeClick={handleNodeClick}
            onNodePageClick={handleNodePageClick}
            isHighlighted={isHighlighted}
            showLabel={showLabel}
            isDragged={draggedNodeId === node.page_id}
            isDraggingGlobal={isDragging}
            onHover={(nodeId) => {
              // Don't update hover state while dragging - keep it locked
              if (!isDragging) {
                setHoveredNodeId(nodeId)
                // Only update ref when hovering (not when clearing)
                // This preserves the last hovered node for click handler
                if (nodeId !== null) {
                  hoveredNodeIdRef.current = nodeId
                }
              }
            }}
            onPointerDownCapture={(pageId) => {
              // Capture the hovered node when pointer goes down (before click)
              // This is the same pattern as drag - capture early, before pointer out fires
              // Use the state value directly (same as drag logic)
              clickedHoveredNodeIdRef.current = hoveredNodeId
              console.log('[GraphVisualization] Pointer down - node:', pageId, 'captured hovered (state):', hoveredNodeId, 'captured hovered (ref):', hoveredNodeIdRef.current)
            }}
            onNodeSelect={(pageId) => {
              // Single click - persist the current hover highlights
              // Use the captured hovered node from pointer down (same as drag logic)
              // This ensures we get the hovered node before pointer out clears it
              const nodeToSelect = clickedHoveredNodeIdRef.current !== null 
                ? clickedHoveredNodeIdRef.current 
                : (hoveredNodeId !== null ? hoveredNodeId : (hoveredNodeIdRef.current !== null ? hoveredNodeIdRef.current : pageId))
              console.log('[GraphVisualization] Node select - clicked:', pageId, 'captured on pointerDown:', clickedHoveredNodeIdRef.current, 'hovered (state):', hoveredNodeId, 'hovered (ref):', hoveredNodeIdRef.current, 'selecting:', nodeToSelect)
              setSelectedNodeId(nodeToSelect)
              
              // Clear the captured value after using it
              clickedHoveredNodeIdRef.current = null
            }}
            onDragStart={(pageId) => {
              setIsDragging(true)
              // Set the dragged node to show it in yellow and persist its label
              setDraggedNodeId(pageId)
              // Also lock the hovered node for highlighting (same as before)
              if (hoveredNodeId !== null) {
                setLockedHoveredNodeId(hoveredNodeId)
              } else {
                // If no hovered node, use the clicked node for highlighting
                setLockedHoveredNodeId(pageId)
              }
            }}
            onDragEnd={(pageId) => {
              setIsDragging(false)
              setDraggedNodeId(null)
              // Persist the selection after drag ends - set selectedNodeId to the dragged node
              // This keeps the highlights active after you release
              setSelectedNodeId(pageId)
              // Clear locked hover when drag ends (selection is now in selectedNodeId)
              setLockedHoveredNodeId(null)
            }}
          />
        )
      })}
      
      <OrbitControls 
        enableDamping 
        dampingFactor={0.05}
        makeDefault
      />
      
      {/* Track drag state via canvas events */}
      <DragTracker 
        onDragStart={() => {
          setIsDragging(true)
          // Lock the current hovered node when drag starts
          if (hoveredNodeId !== null) {
            setLockedHoveredNodeId(hoveredNodeId)
          }
        }}
        onDragEnd={() => {
          setIsDragging(false)
          // Clear dragged node and locked hover when drag ends
          setDraggedNodeId(null)
          setLockedHoveredNodeId(null)
        }}
      />
      
      {/* Camera animation controller */}
      {targetPosition && isAnimating && (
        <CameraAnimator targetPosition={targetPosition} />
      )}
    </Canvas>
  )
}
