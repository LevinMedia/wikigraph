'use client'

import { useMemo, useRef } from 'react'
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
  isFirstDegree
}: { 
  node: GraphNode
  position: [number, number, number]
  isFirstDegree?: boolean
}) {
  // Size based on degree (log scale for better visualization)
  const totalDegree = node.out_degree + node.in_degree
  const size = Math.max(0.15, Math.min(1.2, Math.log10(totalDegree + 1) / 2.5))
  
  // Color: center node is red, 1st degree nodes are purple (lighter if more incoming links), others based on degree
  const color = node.is_center
    ? '#ff6b6b' // Center node always red
    : isFirstDegree
      ? (node.in_degree > node.out_degree 
          ? '#a78bfa' // 1st degree nodes with more incoming: very light purple
          : '#6b46c1') // 1st degree nodes: dark purple
      : node.in_degree > node.out_degree 
        ? '#4ecdc4' 
        : '#95e1d3'

  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial 
          color={color} 
          emissive={color} 
          emissiveIntensity={0.15}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>
      {node.is_center && (
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

export default function GraphVisualization({ data, onNodeClick }: GraphVisualizationProps) {
  const { nodes, edges } = data
  
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

  // Calculate which nodes are first-degree (directly connected to center)
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

  return (
    <Canvas 
      camera={{ position: [0, 0, 25], fov: 50 }}
      shadows
    >
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
      {edges.map((edge) => {
        const fromPos = nodePositions.get(edge.from)
        const toPos = nodePositions.get(edge.to)
        if (!fromPos || !toPos) return null
        
        // Default edge styling
        const edgeColor = '#4a5568'
        const edgeOpacity = 0.3
        
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
        
        const isFirstDegree = firstDegreeNodes.has(node.page_id)
        
        return (
          <GraphNode3D 
            key={`${node.page_id}-${data.center_page_id}`} 
            node={node} 
            position={pos}
            isFirstDegree={isFirstDegree}
          />
        )
      })}
      
      <OrbitControls 
        enableDamping 
        dampingFactor={0.05}
        makeDefault
      />
    </Canvas>
  )
}
