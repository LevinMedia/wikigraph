'use client'

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
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
  onNodeSelect?: (pageId: number | null) => void
  relationshipFilters?: {
    showTwoWay: boolean
    showOutbound: boolean
    showInbound: boolean
  }
  externalSelectedNodeId?: number | null
}

// Auto-rotating OrbitControls that pause on user interaction
function AutoRotatingOrbitControls({ 
  isInteracting,
  nodePositions,
  onFitted
}: { 
  isInteracting: boolean
  nodePositions: Map<number, [number, number, number]>
  onFitted?: () => void
}) {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const hasFittedRef = useRef(false)
  const lastNodePositionsSizeRef = useRef(0)
  
  // Reset fitting state when node positions change significantly
  useEffect(() => {
    if (nodePositions.size !== lastNodePositionsSizeRef.current) {
      hasFittedRef.current = false
      lastNodePositionsSizeRef.current = nodePositions.size
    }
  }, [nodePositions])
  
  // Fit camera to view all nodes on first load
  useEffect(() => {
    if (hasFittedRef.current || nodePositions.size === 0) return
    
    // Use a small delay to ensure controls are initialized
    const timeout = setTimeout(() => {
      if (!controlsRef.current) return
      
      // Calculate bounding box of all nodes
      const positions = Array.from(nodePositions.values())
      if (positions.length === 0) return
      
      let minX = Infinity, maxX = -Infinity
      let minY = Infinity, maxY = -Infinity
      let minZ = Infinity, maxZ = -Infinity
      
      positions.forEach(([x, y, z]) => {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      })
      
      // Calculate center and size of bounding box
      const center = new THREE.Vector3(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2
      )
      
      const size = new THREE.Vector3(
        maxX - minX,
        maxY - minY,
        maxZ - minZ
      )
      
      // Calculate the distance needed to fit the bounding box in view
      // Account for camera FOV and add some padding
      const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50
      const fovRad = (fov * Math.PI) / 180
      const maxDim = Math.max(size.x, size.y, size.z)
      const distance = (maxDim / 2) / Math.tan(fovRad / 2)
      
      // Add padding (20% extra space)
      const paddedDistance = distance * 1.2
      
      // Position camera to look at center from a distance
      // Start from a good viewing angle
      const cameraPosition = new THREE.Vector3(
        center.x,
        center.y + paddedDistance * 0.3, // Slightly above
        center.z + paddedDistance
      )
      
      camera.position.copy(cameraPosition)
      camera.lookAt(center)
      camera.updateProjectionMatrix()
      
      // Update controls target
      if (controlsRef.current) {
        controlsRef.current.target.copy(center)
        controlsRef.current.update()
      }
      
      hasFittedRef.current = true
      if (onFitted) onFitted()
    }, 100) // Small delay to ensure controls are ready
    
    return () => clearTimeout(timeout)
  }, [nodePositions, camera, onFitted])
  
  return (
    <OrbitControls 
      ref={controlsRef}
      enableDamping 
      dampingFactor={0.05}
      makeDefault
      autoRotate={!isInteracting}
      autoRotateSpeed={0.5}
    />
  )
}

// Edge component with smooth opacity and color transitions
function Edge3D({ 
  fromPos, 
  toPos, 
  color, 
  targetOpacity, 
  isHighlighted 
}: { 
  fromPos: [number, number, number]
  toPos: [number, number, number]
  color: string
  targetOpacity: number
  isHighlighted: boolean
}) {
  const materialRef = useRef<THREE.LineBasicMaterial>(null)
  const currentOpacityRef = useRef(targetOpacity) // Initialize to target opacity
  const currentColorRef = useRef(new THREE.Color(color))
  const targetColorRef = useRef(new THREE.Color(color))
  
  // Update target color and opacity when they change
  useEffect(() => {
    targetColorRef.current.set(color)
  }, [color])
  
  useEffect(() => {
    // Don't reset current opacity, let it lerp smoothly
  }, [targetOpacity])
  
  useFrame(() => {
    if (materialRef.current) {
      const lerpFactor = 0.15 // Match node and label transition speed
      
      // Smoothly transition color
      currentColorRef.current.lerp(targetColorRef.current, lerpFactor)
      materialRef.current.color.copy(currentColorRef.current)
      
      // Lerp towards target opacity for smooth transition
      currentOpacityRef.current += (targetOpacity - currentOpacityRef.current) * lerpFactor
      materialRef.current.opacity = currentOpacityRef.current
    }
  })
  
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={new Float32Array([...fromPos, ...toPos])}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial 
        ref={materialRef}
        color={currentColorRef.current} 
        opacity={currentOpacityRef.current}
        transparent={true}
        linewidth={isHighlighted ? 2 : 1}
      />
    </line>
  )
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

// Elastic easing function (ease-out-elastic)
function elasticOut(t: number): number {
  const c4 = (2 * Math.PI) / 3
  return t === 0
    ? 0
    : t === 1
    ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}

function GraphNode3D({ 
  node, 
  position,
  isFirstDegree,
  relationshipType,
  isHovered,
  isSelected,
  isInMesh,
  isMeshActive,
  onHover,
  onUnhover,
  onClick,
  animationStartTime,
  animationDuration
}: { 
  node: GraphNode
  position: [number, number, number]
  isFirstDegree?: boolean
  relationshipType?: 'Two way' | 'Inbound' | 'Outbound' | null
  isHovered?: boolean
  isSelected?: boolean
  isInMesh?: boolean
  isMeshActive?: boolean
  onHover?: () => void
  onUnhover?: () => void
  onClick?: (e: any) => void
  animationStartTime?: number
  animationDuration?: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const labelGroupRef = useRef<THREE.Group>(null)
  const targetOpacityRef = useRef(1.0)
  const currentOpacityRef = useRef(1.0)
  const nodeAnimationStartTimeRef = useRef<number | null>(null)
  const currentColorRef = useRef(new THREE.Color())
  const targetColorRef = useRef(new THREE.Color())
  const labelOpacityRef = useRef(0)
  
  // Size based on degree (log scale for better visualization)
  const totalDegree = node.out_degree + node.in_degree
  const size = Math.max(0.15, Math.min(1.2, Math.log10(totalDegree + 1) / 2.5))
  
  // Base color based on relationship type with center node
  let baseColor = node.is_center
    ? '#ff6b6b' // Center node always red
    : relationshipType === 'Two way'
      ? '#4ecdc4' // Cyan for two-way
      : relationshipType === 'Inbound'
        ? '#8b5cf6' // Purple for inbound
        : relationshipType === 'Outbound'
          ? '#a78bfa' // Light purple for outbound
          : '#95e1d3' // Default teal for other nodes
  
  // Initialize scale, color, and label opacity based on whether it's the center node
  useEffect(() => {
    if (groupRef.current) {
      if (node.is_center) {
        groupRef.current.scale.setScalar(1)
        labelOpacityRef.current = 1.0 // Center node label visible immediately
      } else {
        groupRef.current.scale.setScalar(0)
        labelOpacityRef.current = 0.0 // Other nodes start with label hidden
      }
    }
    // Initialize label group visibility
    if (labelGroupRef.current) {
      labelGroupRef.current.visible = node.is_center
      // Set initial opacity on materials
      labelGroupRef.current.traverse((child: any) => {
        if (child.material) {
          child.material.opacity = labelOpacityRef.current
          child.material.transparent = true
        }
        if (Array.isArray(child.material)) {
          child.material.forEach((mat: any) => {
            if (mat) {
              mat.opacity = labelOpacityRef.current
              mat.transparent = true
            }
          })
        }
      })
    }
    // Initialize current color to base color
    currentColorRef.current.set(baseColor)
    targetColorRef.current.set(baseColor)
  }, [node.is_center, baseColor])
  
  // Make color brighter on hover, selection, or when part of the mesh (for 1st degree nodes)
  const isHighlighted = ((isHovered || isSelected || isInMesh) && isFirstDegree)
  const isHoveredOrSelected = (isHovered || isSelected) && isFirstDegree
  
  // Calculate target color
  let targetColorStr = baseColor
  if (isHoveredOrSelected) {
    // Very light yellow for hovered/selected node
    targetColorStr = '#fef9c3' // Very light yellow
  } else if (isInMesh && isFirstDegree) {
    // Use relationship type color but slightly brighter for mesh nodes
    targetColorStr = relationshipType === 'Two way'
      ? '#5ed5d5' // Brighter cyan
      : relationshipType === 'Inbound'
        ? '#9d6df7' // Brighter purple
        : relationshipType === 'Outbound'
          ? '#c4b5fd' // Brighter light purple
          : baseColor
  }
  
  // Update target color
  targetColorRef.current.set(targetColorStr)
  
  // Calculate target opacity (smooth for all transitions)
  const shouldFade = isMeshActive && !isInMesh && !node.is_center
  const targetOpacity = shouldFade ? 0.15 : 1.0
  targetOpacityRef.current = targetOpacity
  
  // Calculate target label opacity (smooth fade in/out)
  const shouldShowLabel = node.is_center || ((isHovered || isSelected || isInMesh) && isFirstDegree)
  const targetLabelOpacity = shouldShowLabel ? 1.0 : 0.0
  
  // Reduce emissive intensity when opacity is reduced - remove emissive entirely when faded
  const baseEmissiveIntensity = isHighlighted ? 0.4 : 0.15
  
  // Smoothly transition color, opacity, and label using useFrame
  useFrame(() => {
    const lerpFactor = 0.15 // Adjust this for faster/slower transitions
    
    if (materialRef.current) {
      // Smoothly transition color
      currentColorRef.current.lerp(targetColorRef.current, lerpFactor)
      materialRef.current.color.copy(currentColorRef.current)
      
      // Lerp towards target opacity for smooth transition
      currentOpacityRef.current += (targetOpacityRef.current - currentOpacityRef.current) * lerpFactor
      materialRef.current.opacity = currentOpacityRef.current
      
      // Also smoothly transition emissive intensity
      const targetEmissiveIntensity = targetOpacityRef.current < 1.0 ? 0 : baseEmissiveIntensity
      const currentEmissive = materialRef.current.emissiveIntensity || 0
      const newEmissive = currentEmissive + (targetEmissiveIntensity - currentEmissive) * lerpFactor
      materialRef.current.emissiveIntensity = newEmissive
      
      // Update emissive color smoothly
      if (targetOpacityRef.current < 1.0) {
        materialRef.current.emissive.set('#000000')
      } else {
        materialRef.current.emissive.copy(currentColorRef.current)
      }
    }
    
    // Smoothly transition label opacity
    if (labelGroupRef.current) {
      labelOpacityRef.current += (targetLabelOpacity - labelOpacityRef.current) * lerpFactor
      
      // Update visibility based on opacity
      const shouldBeVisible = labelOpacityRef.current > 0.01
      labelGroupRef.current.visible = shouldBeVisible
      
      // Apply opacity to all materials in the label group
      if (shouldBeVisible) {
        labelGroupRef.current.traverse((child: any) => {
          if (child.material) {
            child.material.opacity = labelOpacityRef.current
            child.material.transparent = true
          }
          // drei Text component may have multiple materials (text + outline)
          if (Array.isArray(child.material)) {
            child.material.forEach((mat: any) => {
              if (mat) {
                mat.opacity = labelOpacityRef.current
                mat.transparent = true
              }
            })
          }
        })
      }
    }
  })

  // Initialize animation start time when it's provided
  useEffect(() => {
    if (animationStartTime !== undefined && nodeAnimationStartTimeRef.current === null) {
      nodeAnimationStartTimeRef.current = animationStartTime
    }
  }, [animationStartTime])

  // Animate scale with elastic easing
  useFrame((state, delta) => {
    if (groupRef.current) {
      // Center node appears immediately without animation
      if (node.is_center) {
        groupRef.current.scale.setScalar(1)
        return
      }
      
      // For other nodes, animate if we have timing info
      if (nodeAnimationStartTimeRef.current !== null && animationDuration) {
        const elapsed = state.clock.elapsedTime - nodeAnimationStartTimeRef.current
        const progress = Math.min(1, Math.max(0, elapsed / animationDuration))
        
        if (progress < 1) {
          const easedProgress = elasticOut(progress)
          groupRef.current.scale.setScalar(easedProgress)
        } else {
          groupRef.current.scale.setScalar(1)
        }
      } else {
        // If no animation timing yet, start at scale 0
        groupRef.current.scale.setScalar(0)
      }
    }
  })

  return (
    <group position={position} ref={groupRef}>
      <mesh 
        ref={meshRef}
        castShadow 
        receiveShadow
        onPointerOver={(e) => {
          e.stopPropagation()
          if (onHover) onHover()
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          if (onUnhover) onUnhover()
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (onClick) onClick(e)
        }}
      >
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial 
          ref={materialRef}
          color={currentColorRef.current} 
          emissive={currentColorRef.current} 
          emissiveIntensity={baseEmissiveIntensity}
          roughness={0.4}
          metalness={0.1}
          transparent={true}
          opacity={currentOpacityRef.current}
        />
      </mesh>
      <group ref={labelGroupRef} position={[0, size + 0.3, 0]}>
        <BillboardText
          fontSize={1.0}
          color="#eaf0ff"
        >
          {node.title}
        </BillboardText>
      </group>
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

export default function GraphVisualization({ data, onNodeClick, onNodeSelect, relationshipFilters, externalSelectedNodeId }: GraphVisualizationProps) {
  const { nodes, edges } = data
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [isUserInteracting, setIsUserInteracting] = useState(false)
  const animationStartTimeRef = useRef<number | null>(null)
  const [hasFittedCamera, setHasFittedCamera] = useState(false)
  
  // Sync external selected node ID with internal state
  useEffect(() => {
    if (externalSelectedNodeId !== undefined) {
      setSelectedNodeId(externalSelectedNodeId)
    }
  }, [externalSelectedNodeId])
  
  // Initialize animation start time when graph data changes
  useEffect(() => {
    animationStartTimeRef.current = null // Reset on new graph
    setHasFittedCamera(false) // Reset camera fitting
  }, [data.center_page_id, nodes.length])
  
  // Calculate node positions ONCE using ALL nodes and edges (don't recalculate when filters change)
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
  
  // Calculate animation order: Two way (by connections desc), Inbound (by connections desc), Outbound (by connections desc)
  const animationOrder = useMemo(() => {
    const centerId = data.center_page_id
    const order = new Map<number, number>() // node_id -> animation index
    
    // Separate nodes by relationship type
    const twoWayNodes: GraphNode[] = []
    const inboundNodes: GraphNode[] = []
    const outboundNodes: GraphNode[] = []
    const otherNodes: GraphNode[] = []
    
    // Use ALL edges to determine relationship types (not filtered)
    nodes.forEach(node => {
      if (node.is_center) {
        // Center node animates immediately (index 0)
        order.set(node.page_id, 0)
        return
      }
      
      const hasOutbound = edges.some(e => e.from === centerId && e.to === node.page_id)
      const hasInbound = edges.some(e => e.to === centerId && e.from === node.page_id)
      
      if (hasOutbound && hasInbound) {
        twoWayNodes.push(node)
      } else if (hasInbound) {
        inboundNodes.push(node)
      } else if (hasOutbound) {
        outboundNodes.push(node)
      } else {
        otherNodes.push(node)
      }
    })
    
    // Sort each group by total connections (descending)
    const sortByConnections = (a: GraphNode, b: GraphNode) => {
      const aTotal = a.out_degree + a.in_degree
      const bTotal = b.out_degree + b.in_degree
      return bTotal - aTotal
    }
    
    twoWayNodes.sort(sortByConnections)
    inboundNodes.sort(sortByConnections)
    outboundNodes.sort(sortByConnections)
    otherNodes.sort(sortByConnections)
    
    // Assign animation indices
    let index = 1 // Start at 1 (0 is center)
    
    // Two way nodes first
    twoWayNodes.forEach(node => {
      order.set(node.page_id, index++)
    })
    
    // Inbound nodes second
    inboundNodes.forEach(node => {
      order.set(node.page_id, index++)
    })
    
    // Outbound nodes third
    outboundNodes.forEach(node => {
      order.set(node.page_id, index++)
    })
    
    // Other nodes last
    otherNodes.forEach(node => {
      order.set(node.page_id, index++)
    })
    
    return order
  }, [nodes, edges, data.center_page_id])
  
  // Component to initialize animation timing using the clock
  function AnimationInitializer() {
    const { clock } = useThree()
    
    useEffect(() => {
      // Initialize start time when component mounts
      if (animationStartTimeRef.current === null) {
        animationStartTimeRef.current = clock.elapsedTime
      }
    }, [clock])
    
    return null
  }
  
  // Get animation start time for a node
  const getAnimationStartTime = useCallback((nodeId: number): number | undefined => {
    if (animationStartTimeRef.current === null) {
      return undefined // Not initialized yet
    }
    
    const animationIndex = animationOrder.get(nodeId) ?? 0
    const delayBetweenNodes = 0.05 // 50ms between each node
    const startTime = animationStartTimeRef.current + (animationIndex * delayBetweenNodes)
    
    return startTime
  }, [animationOrder])
  
  // Filter edges based on relationship type filters (for display only, not for position calculation)
  const filteredEdges = useMemo(() => {
    if (!relationshipFilters) return edges
    
    const { showTwoWay, showOutbound, showInbound } = relationshipFilters
    const centerId = data.center_page_id
    
    // First, determine which nodes are visible (connected to center via visible relationship types)
    const visibleNodeIds = new Set<number>([centerId]) // Center is always visible
    
    edges.forEach(edge => {
      const isFromCenter = edge.from === centerId
      const isToCenter = edge.to === centerId
      
      if (isFromCenter || isToCenter) {
        const connectedNodeId = isFromCenter ? edge.to : edge.from
        const isTwoWay = isFromCenter && edges.some(e => e.from === connectedNodeId && e.to === centerId) ||
                         isToCenter && edges.some(e => e.from === centerId && e.to === connectedNodeId)
        
        if (isTwoWay && showTwoWay) {
          visibleNodeIds.add(connectedNodeId)
        } else if (isFromCenter && showOutbound) {
          visibleNodeIds.add(connectedNodeId)
        } else if (isToCenter && showInbound) {
          visibleNodeIds.add(connectedNodeId)
        }
      }
    })
    
    // Now filter edges: show edges to/from center if visible, and show edges between visible nodes
    return edges.filter(edge => {
      const isFromCenter = edge.from === centerId
      const isToCenter = edge.to === centerId
      
      // If edge connects to center, check if it should be visible based on relationship type
      if (isFromCenter || isToCenter) {
        const isTwoWay = isFromCenter && edges.some(e => e.from === edge.to && e.to === centerId) ||
                         isToCenter && edges.some(e => e.from === centerId && e.to === edge.from)
        
        if (isTwoWay) return showTwoWay
        if (isFromCenter) return showOutbound
        if (isToCenter) return showInbound
      }
      
      // For edges between non-center nodes, show them if BOTH endpoints are visible
      return visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)
    })
  }, [edges, relationshipFilters, data.center_page_id])
  
  // Determine which nodes should be visible based on filtered edges
  const visibleNodeIds = useMemo(() => {
    const ids = new Set<number>([data.center_page_id]) // Always show center
    filteredEdges.forEach(edge => {
      ids.add(edge.from)
      ids.add(edge.to)
    })
    return ids
  }, [filteredEdges, data.center_page_id])

  // Calculate which nodes are first-degree (directly connected to center) - use ALL edges, not filtered
  const firstDegreeNodes = useMemo(() => {
    const firstDegreeSet = new Set<number>()
    edges.forEach(edge => {
      if (edge.from === data.center_page_id) {
        firstDegreeSet.add(edge.to)
      }
      if (edge.to === data.center_page_id) {
        firstDegreeSet.add(edge.from)
      }
    })
    return firstDegreeSet
  }, [edges, data.center_page_id])
  
  // Find all 1st-degree nodes that are connected to the hovered/selected node
  const getConnectedFirstDegreeNodes = (nodeId: number | null): Set<number> => {
    if (!nodeId || !firstDegreeNodes.has(nodeId)) return new Set()
    
    const connected = new Set<number>()
    edges.forEach(edge => {
      // Check if this edge connects the highlighted node to another 1st-degree node
      if (edge.from === nodeId && firstDegreeNodes.has(edge.to)) {
        connected.add(edge.to)
      } else if (edge.to === nodeId && firstDegreeNodes.has(edge.from)) {
        connected.add(edge.from)
      }
    })
    return connected
  }
  
  // Get all nodes that should be highlighted (hovered/selected + connected 1st-degree nodes)
  const getHighlightedNodes = (): Set<number> => {
    const highlightedId = selectedNodeId || hoveredNodeId
    if (!highlightedId || !firstDegreeNodes.has(highlightedId)) return new Set()
    
    const highlighted = new Set<number>([highlightedId])
    const connected = getConnectedFirstDegreeNodes(highlightedId)
    connected.forEach(id => highlighted.add(id))
    return highlighted
  }
  
  // Check if an edge should be highlighted
  const isEdgeHighlighted = (edge: GraphEdge): boolean => {
    const highlightedId = selectedNodeId || hoveredNodeId
    if (!highlightedId || !firstDegreeNodes.has(highlightedId)) return false
    
    const highlightedNodes = getHighlightedNodes()
    
    // Highlight edge from center to any highlighted mesh node
    if ((edge.from === data.center_page_id && highlightedNodes.has(edge.to)) ||
        (edge.to === data.center_page_id && highlightedNodes.has(edge.from))) {
      return true
    }
    
    // Highlight edges between any highlighted mesh nodes
    if (highlightedNodes.has(edge.from) && highlightedNodes.has(edge.to)) {
      return true
    }
    
    return false
  }

  return (
    <Canvas 
      camera={{ position: [0, 0, 25], fov: 50 }}
      shadows
    >
      <AnimationInitializer />
      
      {/* Invisible background plane to catch clicks outside nodes */}
      <mesh 
        position={[0, 0, -50]}
        onClick={(e) => {
          e.stopPropagation()
          setSelectedNodeId(null)
        }}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      
      {/* Ambient light for overall illumination */}
      <ambientLight intensity={0.4} />
      
      {/* Main directional light from top-right */}
      <directionalLight 
        position={[15, 15, 15]} 
        intensity={0.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      
      {/* Fill light from bottom-left to reduce harsh shadows */}
      <directionalLight 
        position={[-10, -10, 5]} 
        intensity={0.3}
        color="#4ecdc4"
      />
      
      {/* Point light for additional depth */}
      <pointLight 
        position={[10, 10, 10]} 
        intensity={0.6}
        distance={50}
        decay={2}
      />
      
      {/* Rim light from behind for edge definition */}
      <pointLight 
        position={[-15, -15, -15]} 
        intensity={0.4}
        color="#6b46c1"
        distance={50}
        decay={2}
      />
      
      {/* Edges - all edges between any nodes */}
      {filteredEdges.map((edge) => {
        const fromPos = nodePositions.get(edge.from)
        const toPos = nodePositions.get(edge.to)
        if (!fromPos || !toPos) return null
        
        // Highlight edge if it's part of the first-degree mesh
        const isHighlighted = isEdgeHighlighted(edge)
        const highlightedNodes = getHighlightedNodes()
        const isMeshActive = highlightedNodes.size > 0
        
        // Reduce opacity for edges not in the mesh when mesh is active
        let edgeOpacity = isHighlighted ? 0.8 : 0.3
        if (isMeshActive && !isHighlighted) {
          edgeOpacity = 0.1 // Very low opacity for non-mesh edges when mesh is active
        }
        
        const edgeColor = isHighlighted ? '#eaf0ff' : '#4a5568'
        
        return (
          <Edge3D
            key={`edge-${edge.from}-${edge.to}-${data.center_page_id}`}
            fromPos={fromPos}
            toPos={toPos}
            color={edgeColor}
            targetOpacity={edgeOpacity}
            isHighlighted={isHighlighted}
          />
        )
      })}
      
      {/* Nodes - render all nodes but only show visible ones */}
      {(() => {
        // Calculate isMeshActive once for all nodes
        const highlightedNodes = getHighlightedNodes()
        const isMeshActive = highlightedNodes.size > 0
        
        return nodes.map((node) => {
          // Skip rendering if node is not visible
          if (!visibleNodeIds.has(node.page_id)) {
            return null
          }
          const pos = nodePositions.get(node.page_id)
          if (!pos) {
            console.warn(`[GraphVisualization] Node ${node.page_id} (${node.title}) has no position, skipping render`)
            return null
          }
          
          const isFirstDegree = firstDegreeNodes.has(node.page_id)
          const isHovered = hoveredNodeId === node.page_id
          const isSelected = selectedNodeId === node.page_id
          
          // Determine relationship type with center node
          let relationshipType: 'Two way' | 'Inbound' | 'Outbound' | null = null
          if (isFirstDegree && !node.is_center) {
            const hasOutbound = filteredEdges.some(e => e.from === data.center_page_id && e.to === node.page_id)
            const hasInbound = filteredEdges.some(e => e.to === data.center_page_id && e.from === node.page_id)
            
            if (hasOutbound && hasInbound) {
              relationshipType = 'Two way'
            } else if (hasInbound) {
              relationshipType = 'Inbound'
            } else if (hasOutbound) {
              relationshipType = 'Outbound'
            }
          }
          
          // Check if this node should be highlighted as part of the first-degree mesh
          const isInMesh = highlightedNodes.has(node.page_id)
          
          // Get animation timing for this node
          const animationStartTime = getAnimationStartTime(node.page_id)
          const animationDuration = 0.8 // 800ms for each node animation
          
          return (
            <GraphNode3D 
              key={`${node.page_id}-${data.center_page_id}`} 
              node={node} 
              position={pos}
              isFirstDegree={isFirstDegree}
              relationshipType={relationshipType}
              isHovered={isHovered}
              isSelected={isSelected}
              isInMesh={isInMesh}
              isMeshActive={isMeshActive}
              animationStartTime={animationStartTime}
              animationDuration={animationDuration}
              onHover={() => setHoveredNodeId(node.page_id)}
              onUnhover={() => setHoveredNodeId(null)}
              onClick={(e) => {
                e.stopPropagation()
                // Toggle selection: if clicking the same node, deselect; otherwise select new node
                if (isFirstDegree) {
                  const newSelectedId = selectedNodeId === node.page_id ? null : node.page_id
                  setSelectedNodeId(newSelectedId)
                  // Notify parent about selection change for list sync
                  if (onNodeSelect) {
                    onNodeSelect(newSelectedId)
                  }
                  // Don't call onNodeClick for 1st-degree nodes - they're just for selection
                  return
                }
                // For non-1st-degree nodes, call the parent's onNodeClick for navigation
                if (onNodeClick) {
                  onNodeClick(node.page_id)
                }
              }}
            />
          )
        })
      })()}
      
      <AutoRotatingOrbitControls 
        isInteracting={isUserInteracting}
        nodePositions={nodePositions}
        onFitted={() => setHasFittedCamera(true)}
      />
    </Canvas>
  )
}
