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
  onNodePageClick
}: { 
  node: GraphNode
  position: [number, number, number]
  onNodeClick: (position: [number, number, number]) => void
  onNodePageClick?: (pageId: number) => void
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  
  // Size based on degree (log scale for better visualization)
  const totalDegree = node.out_degree + node.in_degree
  const size = Math.max(0.15, Math.min(1.2, Math.log10(totalDegree + 1) / 2.5))
  
  // Color: center node is different, others based on in/out ratio
  const color = node.is_center 
    ? '#ff6b6b' 
    : node.in_degree > node.out_degree 
      ? '#4ecdc4' 
      : '#95e1d3'

  return (
    <group position={position}>
      <mesh 
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation()
          onNodeClick(position)
          if (onNodePageClick) {
            onNodePageClick(node.page_id)
          }
        }}
      >
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial 
          color={hovered ? '#ffffff' : color} 
          emissive={hovered ? '#ffffff' : color} 
          emissiveIntensity={hovered ? 0.5 : 0.2}
        />
      </mesh>
      {(node.is_center || hovered) && (
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
    if (onNodeClick) {
      onNodeClick(pageId)
    }
  }

  return (
    <Canvas camera={{ position: [0, 0, 25], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <pointLight position={[-10, -10, -10]} color="#4ecdc4" />
      
      {/* Edges - all edges between any nodes */}
      {edges.map((edge) => {
        const fromPos = nodePositions.get(edge.from)
        const toPos = nodePositions.get(edge.to)
        if (!fromPos || !toPos) return null
        
        // Calculate edge length for varying distances
        const distance = Math.sqrt(
          Math.pow(toPos[0] - fromPos[0], 2) +
          Math.pow(toPos[1] - fromPos[1], 2) +
          Math.pow(toPos[2] - fromPos[2], 2)
        )
        
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
              color="#60a5fa" 
              opacity={0.7}
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
        return (
          <GraphNode3D 
            key={`${node.page_id}-${data.center_page_id}`} 
            node={node} 
            position={pos}
            onNodeClick={handleNodeClick}
            onNodePageClick={handleNodePageClick}
          />
        )
      })}
      
      <OrbitControls 
        enableDamping 
        dampingFactor={0.05}
        makeDefault
      />
      
      {/* Camera animation controller */}
      {targetPosition && isAnimating && (
        <CameraAnimator targetPosition={targetPosition} />
      )}
    </Canvas>
  )
}
