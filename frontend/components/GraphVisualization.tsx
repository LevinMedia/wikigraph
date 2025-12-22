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
  expansionHub?: { hubNodeId: number, newNodeIds: Set<number> } | null
  onNodeClick?: (pageId: number) => void
  onNodeDoubleClick?: (pageId: number) => void
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
  shouldRefit,
  onFitted
}: { 
  isInteracting: boolean
  nodePositions: Map<number, [number, number, number]>
  shouldRefit?: boolean
  onFitted?: () => void
}) {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const hasFittedRef = useRef(false)
  const lastNodePositionsSizeRef = useRef(0)
  
  // Reset fitting state only when shouldRefit is true (new root graph, not expansion)
  useEffect(() => {
    if (shouldRefit && !hasFittedRef.current) {
      hasFittedRef.current = false
      lastNodePositionsSizeRef.current = 0 // Reset to force refit
    }
  }, [shouldRefit])
  
  // Fit camera to view all nodes on first load (only when shouldRefit is true)
  useEffect(() => {
    if (!shouldRefit || hasFittedRef.current || nodePositions.size === 0) return
    
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

// Pulse component that moves along an edge
function EdgePulse({
  fromPos,
  toPos,
  color,
  direction,
  offset = 0,
  speed = 0.5, // 100% slower (half speed)
  pingPong = false,
  radius = 0.03 // Default pulse radius (reduced for subtler effect)
}: {
  fromPos: [number, number, number]
  toPos: [number, number, number]
  color: string
  direction: 'forward' | 'backward'
  offset?: number
  speed?: number
  pingPong?: boolean
  radius?: number
}) {
  const pulseRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const progressRef = useRef(offset)
  const pingPongDirectionRef = useRef(1) // 1 for forward, -1 for backward
  const startTimeRef = useRef<number | null>(null)
  const cycleTimeRef = useRef(0)
  const fadeOpacityRef = useRef(1.0) // Track fade in/out opacity
  
  // Calculate edge vector and length
  const edgeVector = useMemo(() => {
    return new THREE.Vector3(...toPos).sub(new THREE.Vector3(...fromPos))
  }, [fromPos, toPos])
  
  const edgeLength = useMemo(() => {
    return edgeVector.length()
  }, [edgeVector])
  
  // Pulse cycle duration: pulse visible for 3 seconds, then 5 second wait before next pulse
  // For one-way pulses: need time for grow (1s) + travel (1s) + shrink (1s) = 3 seconds at speed 0.5
  // Set visible duration to exactly match the pulse cycle time to prevent flash
  const cycleDuration = 8.0 // seconds per cycle (3s visible + 5s wait)
  const visibleDuration = 3.0 // visible for exactly the time needed to complete full one-way cycle (grow + travel + shrink)
  
  // Pulse length as a fraction of edge length - half the edge length
  const pulseLengthFraction = 0.5 // 50% of edge length
  
  useFrame((state, delta) => {
    if (pulseRef.current) {
      // Initialize start time on first frame
      if (startTimeRef.current === null) {
        startTimeRef.current = state.clock.elapsedTime
      }
      
      const elapsed = state.clock.elapsedTime - startTimeRef.current
      cycleTimeRef.current = elapsed % cycleDuration
      
      // Only show pulse during visible portion of cycle (1/3 of the time)
      const isVisible = cycleTimeRef.current < visibleDuration
      pulseRef.current.visible = isVisible
      
      if (!isVisible) {
        // Reset progress when pulse becomes invisible, so it starts fresh next cycle
        progressRef.current = offset
        pingPongDirectionRef.current = 1
        return
      }
      
      // Reset progress at start of each visible cycle
      const wasInvisible = cycleTimeRef.current - delta < 0 || (cycleTimeRef.current - delta >= visibleDuration && cycleTimeRef.current < visibleDuration)
      if (wasInvisible) {
        progressRef.current = offset
        pingPongDirectionRef.current = 1
      }
      
      if (pingPong) {
        // Ping-pong mode: bounce back and forth from origin
        // Double the speed so round trip (0->1->0) takes same time as one-way (0->1)
        const pingPongSpeed = speed * 2.0
        progressRef.current += delta * pingPongSpeed * pingPongDirectionRef.current
        if (progressRef.current >= 1) {
          progressRef.current = 1
          pingPongDirectionRef.current = -1 // Reverse direction (bounce back)
        } else if (progressRef.current <= 0) {
          progressRef.current = 0
          pingPongDirectionRef.current = 1 // Reverse direction (bounce forward)
        }
      } else {
        // Normal mode: travel in one direction
        // Allow progress to go beyond 1.0 so pulse can shrink at the end
        progressRef.current += delta * speed
        // Only reset when pulse has fully disappeared (after shrinking phase)
        // Pulse shrinks from t=1.0 to t=1.0+maxPulseLength, so reset after that
        const maxPulseLength = 0.5
        if (progressRef.current > 1.0 + maxPulseLength) {
          progressRef.current = 0
        }
      }
      
      const t = direction === 'forward' ? progressRef.current : 1 - progressRef.current
      
      // Pulse should grow from the source node
      // Maximum pulse length is 50% of edge
      const maxPulseLength = 0.5 // 50% of edge length
      
      // Calculate pulse start and end positions
      let pulseStart = 0
      let pulseEnd = 0
      
      // Growth phase: pulse starts at source (0) and grows as it travels
      if (t <= maxPulseLength) {
        pulseStart = 0
        pulseEnd = t // Grow from 0 to maxPulseLength
      }
      // Travel phase: pulse maintains max length and travels
      else if (t <= 1.0) {
        pulseStart = t - maxPulseLength
        pulseEnd = t // Leading edge travels toward target
      }
      // Shrink phase: leading edge stops at target (1.0), tail catches up
      else {
        // Leading edge is fixed at target node (1.0)
        pulseEnd = 1.0
        // Tail continues forward, shrinking the pulse
        // When t = 1.0, pulseStart = 1.0 - maxPulseLength (full length)
        // As t increases beyond 1.0, pulseStart increases toward 1.0 (shrinking)
        pulseStart = Math.min(1.0, t - maxPulseLength)
      }
      
      // Clamp to edge boundaries
      pulseStart = Math.max(0, pulseStart)
      pulseEnd = Math.min(1, pulseEnd)
      
      // Calculate actual pulse center and length after clamping
      const clampedPulseCenter = (pulseStart + pulseEnd) / 2
      const clampedPulseLength = pulseEnd - pulseStart
      
      // Position pulse at clamped center
      const pos = new THREE.Vector3().lerpVectors(
        new THREE.Vector3(...fromPos),
        new THREE.Vector3(...toPos),
        clampedPulseCenter
      )
      pulseRef.current.position.copy(pos)
      
      // Scale pulse length to match clamped length (will shrink to 0 as tail reaches end)
      if (meshRef.current) {
        meshRef.current.scale.y = clampedPulseLength / maxPulseLength // Scale factor
      }
      
      // Calculate fade in opacity only (no fade out - pulse just shrinks)
      // 300ms fade time at speed 0.5: full edge takes 2 seconds, so 300ms = 0.3/2.0 = 0.15 of progress
      const fadeTime = 0.3 // 300ms in seconds
      const fullEdgeTime = 1.0 / speed // Time to travel full edge (2 seconds at speed 0.5)
      const fadeProgress = fadeTime / fullEdgeTime // Fraction of progress for fade (0.15)
      
      let fadeOpacity = 1.0
      // Fade in: when pulse is just starting (leading edge is near 0)
      // Use pulseEnd (leading edge) for fade-in since that's what's visible
      if (pulseEnd < fadeProgress) {
        fadeOpacity = pulseEnd / fadeProgress
      }
      // No fade out - pulse just gets shorter until it disappears
      
      fadeOpacityRef.current = fadeOpacity
      
      // Update material opacity uniform
      if (gradientMaterial.current) {
        gradientMaterial.current.uniforms.fadeOpacity.value = fadeOpacity
      }
      
      // Orient the pulse along the edge direction
      const normalizedEdge = edgeVector.clone().normalize()
      if (normalizedEdge.length() > 0) {
        // Create a quaternion to rotate from Y-axis (cylinder default) to edge direction
        const yAxis = new THREE.Vector3(0, 1, 0)
        const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, normalizedEdge)
        pulseRef.current.quaternion.copy(quaternion)
      }
    }
  })
  
  // Slightly brighten the color for the pulse effect (toned down)
  const brightColor = useMemo(() => {
    const c = new THREE.Color(color)
    c.multiplyScalar(1.2) // Subtle brightness increase
    return c
  }, [color])
  
  // Pulse length as a fraction of edge length - half the edge length
  const pulseLength = edgeLength * 0.5 // 50% of edge length (will be scaled dynamically)
  
  // Create shader material with gradient fade at ends
  const gradientMaterial = useRef<THREE.ShaderMaterial | null>(null)
  const material = useMemo(() => {
    const halfLength = pulseLength / 2
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(brightColor) },
        opacity: { value: 0.6 }, // Reduced opacity for subtler effect
        fadeOpacity: { value: 1.0 }, // Fade in/out opacity (0 to 1)
        halfLength: { value: halfLength }
      },
      vertexShader: `
        varying float vPositionY;
        void main() {
          vPositionY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacity;
        uniform float fadeOpacity;
        uniform float halfLength;
        varying float vPositionY;
        
        void main() {
          // Normalize position along Y axis (-halfLength to +halfLength)
          // Map to 0.0 to 1.0 range
          float normalizedY = (vPositionY + halfLength) / (halfLength * 2.0);
          
          // Dramatic gradient - only middle 20% is fully solid
          // Much more dramatic fade at both ends
          float centerStart = 0.4; // Start of solid center (40%)
          float centerEnd = 0.6;    // End of solid center (60%)
          
          float fade = 1.0;
          if (normalizedY < centerStart) {
            // Dramatic fade in from start - very sharp transition
            fade = smoothstep(0.0, centerStart, normalizedY);
            // Make it even more dramatic by squaring
            fade = fade * fade;
          } else if (normalizedY > centerEnd) {
            // Dramatic fade out at end - very sharp transition
            fade = smoothstep(1.0, centerEnd, normalizedY);
            // Make it even more dramatic by squaring
            fade = fade * fade;
          }
          // Middle section (centerStart to centerEnd) stays at fade = 1.0
          
          // Calculate final opacity with fade
          float finalOpacity = opacity * fade * fadeOpacity;
          
          // Add glow effect by making the color brighter and more emissive
          // The glow intensity is stronger in the center and fades at edges
          float glowIntensity = fade * fadeOpacity;
          vec3 glowColor = color * (1.0 + glowIntensity * 2.0); // Brighten for glow
          
          // Output with glow effect
          gl_FragColor = vec4(glowColor, finalOpacity);
        }
      `,
      transparent: true,
      depthWrite: false, // Don't write to depth buffer to prevent blocking edges behind
      depthTest: true, // Still test depth to respect other objects
      side: THREE.DoubleSide
    })
    gradientMaterial.current = mat
    return mat
  }, [brightColor, pulseLength])
  
  return (
    <group ref={pulseRef} renderOrder={-1}>
      <mesh ref={meshRef} renderOrder={-1}>
        <cylinderGeometry args={[radius, radius, pulseLength, 16, 1]} />
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  )
}

// Edge component with smooth opacity and color transitions
function Edge3D({ 
  fromPos, 
  toPos, 
  color, 
  targetOpacity, 
  isHighlighted,
  pulseColor,
  pulseDirection,
  centerPos,
  pulseRadius,
  onDeselect
}: {
  fromPos: [number, number, number]
  toPos: [number, number, number]
  color: string
  targetOpacity: number
  isHighlighted: boolean
  pulseColor?: string
  pulseDirection?: 'forward' | 'backward' | 'both'
  centerPos?: [number, number, number]
  pulseRadius?: number
  onDeselect?: () => void
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
      const lerpFactor = 0.075 // Twice as long transitions (half the speed)
      
      // Smoothly transition color
      currentColorRef.current.lerp(targetColorRef.current, lerpFactor)
      materialRef.current.color.copy(currentColorRef.current)
      
      // Lerp towards target opacity for smooth transition
      currentOpacityRef.current += (targetOpacity - currentOpacityRef.current) * lerpFactor
      materialRef.current.opacity = currentOpacityRef.current
    }
  })
  
  return (
    <group>
      <line
        onClick={(e) => {
          // Clicking on edges should also deselect nodes
          e.stopPropagation()
          if (onDeselect) {
            onDeselect()
          }
        }}
      >
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
      {/* Pulse animation when highlighted */}
      {isHighlighted && pulseColor && pulseDirection && (() => {
        if (pulseDirection === 'both') {
          // For two-way, render two one-way pulses going in opposite directions
          // Determine which position is the center and which is the node
          let centerPulseFrom = fromPos
          let centerPulseTo = toPos
          let nodePulseFrom = toPos
          let nodePulseTo = fromPos
          
          if (centerPos) {
            const isFromCenter = Math.abs(fromPos[0] - centerPos[0]) < 0.01 && 
                                 Math.abs(fromPos[1] - centerPos[1]) < 0.01 && 
                                 Math.abs(fromPos[2] - centerPos[2]) < 0.01
            if (!isFromCenter) {
              // Swap positions so center pulse goes from center to node
              centerPulseFrom = toPos
              centerPulseTo = fromPos
              nodePulseFrom = fromPos
              nodePulseTo = toPos
            }
          }
          
          return (
            <>
              {/* Pulse from center to node */}
              <EdgePulse 
                fromPos={centerPulseFrom} 
                toPos={centerPulseTo} 
                color={pulseColor} 
                direction="forward"
                radius={pulseRadius}
              />
              {/* Pulse from node to center */}
              <EdgePulse 
                fromPos={nodePulseFrom} 
                toPos={nodePulseTo} 
                color={pulseColor} 
                direction="forward"
                radius={pulseRadius}
              />
            </>
          )
        } else {
          return (
            <EdgePulse 
              fromPos={fromPos} 
              toPos={toPos} 
              color={pulseColor} 
              direction={pulseDirection}
              radius={pulseRadius}
            />
          )
        }
      })()}
    </group>
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
  onDoubleClick,
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
  onDoubleClick?: (e: any) => void
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
  
  // Make color brighter only on hover/selection (not for mesh nodes)
  const isHighlighted = ((isHovered || isSelected || isInMesh) && isFirstDegree)
  const isHoveredOrSelected = (isHovered || isSelected) && isFirstDegree
  
  // Calculate target color
  let targetColorStr = baseColor
  if (isHoveredOrSelected) {
    // Brighten the original color by mixing with white (only for selected/hovered node)
    const baseColorObj = new THREE.Color(baseColor)
    const white = new THREE.Color(0xffffff)
    // Mix 40% white with 60% original color for a bright but still colorful version
    baseColorObj.lerp(white, 0.4)
    targetColorStr = '#' + baseColorObj.getHexString()
  }
  // Mesh nodes (isInMesh) keep their base color - no brightening
  
  // Update target color
  targetColorRef.current.set(targetColorStr)
  
  // Calculate target opacity (smooth for all transitions)
  const shouldFade = isMeshActive && !isInMesh && !node.is_center
  const targetOpacity = shouldFade ? 0.15 : 1.0
  targetOpacityRef.current = targetOpacity
  
  // Calculate target label opacity (smooth fade in/out)
  const shouldShowLabel = node.is_center || ((isHovered || isSelected || isInMesh) && isFirstDegree)
  const targetLabelOpacity = shouldShowLabel ? 1.0 : 0.0
  
  // Emissive intensity: subtle glow for all nodes, brighter for hovered/selected
  // Base glow intensity for all nodes in their relationship color
  const baseGlowIntensity = 0.2 // Subtle glow for all nodes
  const baseEmissiveIntensity = isHoveredOrSelected ? 0.4 : baseGlowIntensity
  
  // Smoothly transition color, opacity, and label using useFrame
  useFrame(() => {
    const lerpFactor = 0.075 // Twice as long transitions (half the speed)
    
    if (materialRef.current) {
      // Smoothly transition color
      currentColorRef.current.lerp(targetColorRef.current, lerpFactor)
      materialRef.current.color.copy(currentColorRef.current)
      
      // Lerp towards target opacity for smooth transition
      currentOpacityRef.current += (targetOpacityRef.current - currentOpacityRef.current) * lerpFactor
      materialRef.current.opacity = currentOpacityRef.current
      
      // Also smoothly transition emissive intensity
      // When faded, reduce glow but keep subtle glow; when normal, use base glow intensity
      const targetEmissiveIntensity = targetOpacityRef.current < 1.0 
        ? baseGlowIntensity * 0.1 // Very subtle glow when faded
        : baseEmissiveIntensity // Normal glow intensity
      const currentEmissive = materialRef.current.emissiveIntensity || 0
      const newEmissive = currentEmissive + (targetEmissiveIntensity - currentEmissive) * lerpFactor
      materialRef.current.emissiveIntensity = newEmissive
      
      // Update emissive color smoothly - always use node color for glow
      materialRef.current.emissive.copy(currentColorRef.current)
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
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (onDoubleClick) onDoubleClick(e)
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
  centerPageId: number,
  expansionHub?: { hubNodeId: number, newNodeIds: Set<number> } | null
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
  
  // Handle expansion: position new nodes radiating from the hub node, away from center
  if (expansionHub) {
    const hubNodeId = expansionHub.hubNodeId
    const hubPos = positions.get(hubNodeId)
    
    if (hubPos) {
      const [hubX, hubY, hubZ] = hubPos
      
      // Get direction from original center to hub (we want to position new nodes away from center)
      const centerToHubX = hubX
      const centerToHubY = hubY
      const centerToHubZ = hubZ
      const centerToHubLength = Math.sqrt(centerToHubX * centerToHubX + centerToHubY * centerToHubY + centerToHubZ * centerToHubZ)
      
      // Get new nodes that need positioning
      const newNodesToPosition = nodes.filter(n => 
        expansionHub.newNodeIds.has(n.page_id) && !positions.has(n.page_id)
      )
      
      console.log(`[calculateNodePositions] Expansion hub: ${hubNodeId} at [${hubX}, ${hubY}, ${hubZ}], ${newNodesToPosition.length} new nodes to position`)
      
      // Position new nodes in a sphere around the hub, much further from original center
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))
      const baseRadius = 10 // Base radius around hub
      
      newNodesToPosition.forEach((node, index) => {
        const totalDegree = node.out_degree + node.in_degree
        const radius = baseRadius + Math.log10(totalDegree + 1) * 1.5
        
        // Spherical coordinates around hub
        const theta = goldenAngle * index
        const y = newNodesToPosition.length > 1 ? 1 - (index / (newNodesToPosition.length - 1)) * 2 : 0
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y))
        
        // Local position relative to hub
        const localX = radiusAtY * Math.cos(theta) * radius
        const localY = y * radius
        const localZ = radiusAtY * Math.sin(theta) * radius
        
        // Push new nodes much further away from the original center (0, 0, 0)
        // Calculate distance from center to hub
        const hubDistanceFromCenter = centerToHubLength
        
        // If center-to-hub direction exists, push new nodes much further out
        if (centerToHubLength > 0) {
          const awayDirectionX = centerToHubX / centerToHubLength
          const awayDirectionY = centerToHubY / centerToHubLength
          const awayDirectionZ = centerToHubZ / centerToHubLength
          
          // Calculate minimum distance from center for new nodes (at least 45 units, or 3.75x hub distance)
          const minDistanceFromCenter = Math.max(hubDistanceFromCenter * 3.75, 45)
          
          // Position node around hub first
          const nodeAroundHubX = hubX + localX
          const nodeAroundHubY = hubY + localY
          const nodeAroundHubZ = hubZ + localZ
          
          // Calculate current distance from center
          const currentDistanceFromCenter = Math.sqrt(
            nodeAroundHubX * nodeAroundHubX + 
            nodeAroundHubY * nodeAroundHubY + 
            nodeAroundHubZ * nodeAroundHubZ
          )
          
          // If node is too close to center, push it further away along the away-from-center direction
          if (currentDistanceFromCenter < minDistanceFromCenter) {
            // Calculate how much we need to push
            const pushNeeded = minDistanceFromCenter - currentDistanceFromCenter
            
            // Push along the away-from-center direction
            const finalX = nodeAroundHubX + awayDirectionX * pushNeeded
            const finalY = nodeAroundHubY + awayDirectionY * pushNeeded
            const finalZ = nodeAroundHubZ + awayDirectionZ * pushNeeded
            
            positions.set(node.page_id, [finalX, finalY, finalZ])
            const finalDistance = Math.sqrt(finalX * finalX + finalY * finalY + finalZ * finalZ)
            console.log(`[calculateNodePositions] Positioned new node ${node.page_id} (${node.title}) at [${finalX.toFixed(2)}, ${finalY.toFixed(2)}, ${finalZ.toFixed(2)}] (${finalDistance.toFixed(2)} units from center, min was ${minDistanceFromCenter.toFixed(2)})`)
          } else {
            // Already far enough, use position around hub
            positions.set(node.page_id, [nodeAroundHubX, nodeAroundHubY, nodeAroundHubZ])
            console.log(`[calculateNodePositions] Positioned new node ${node.page_id} (${node.title}) at [${nodeAroundHubX.toFixed(2)}, ${nodeAroundHubY.toFixed(2)}, ${nodeAroundHubZ.toFixed(2)}] (${currentDistanceFromCenter.toFixed(2)} units from center, already >= ${minDistanceFromCenter.toFixed(2)})`)
          }
        } else {
          // Fallback: position at a fixed distance from center (if hub is at center)
          const fallbackDistance = 45 // Far from center (50% more than 30)
          // Normalize local position to get direction
          const localLength = Math.sqrt(localX * localX + localY * localY + localZ * localZ)
          if (localLength > 0) {
            const dirX = localX / localLength
            const dirY = localY / localLength
            const dirZ = localZ / localLength
            const finalX = dirX * fallbackDistance
            const finalY = dirY * fallbackDistance
            const finalZ = dirZ * fallbackDistance
            positions.set(node.page_id, [finalX, finalY, finalZ])
          } else {
            // Random direction if local position is zero
            const finalX = fallbackDistance
            const finalY = 0
            const finalZ = 0
            positions.set(node.page_id, [finalX, finalY, finalZ])
          }
        }
      })
    } else {
      console.warn(`[calculateNodePositions] Expansion hub ${hubNodeId} not found in positions!`)
    }
  }
  
  // Ensure ALL remaining nodes get positions (fallback for any nodes not yet positioned)
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

export default function GraphVisualization({ data, expansionHub, onNodeClick, onNodeDoubleClick, onNodeSelect, relationshipFilters, externalSelectedNodeId }: GraphVisualizationProps) {
  const { nodes, edges } = data
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [isUserInteracting, setIsUserInteracting] = useState(false)
  const animationStartTimeRef = useRef<number | null>(null)
  const [hasFittedCamera, setHasFittedCamera] = useState(false)
  const prevCenterPageIdRef = useRef<number>(data.center_page_id)
  
  // Sync external selected node ID with internal state
  useEffect(() => {
    if (externalSelectedNodeId !== undefined) {
      setSelectedNodeId(externalSelectedNodeId)
    }
  }, [externalSelectedNodeId])
  
  // Initialize animation start time when graph data changes
  // Only reset camera fitting if center_page_id changes (new root), not when expanding
  useEffect(() => {
    animationStartTimeRef.current = null // Reset on new graph
    // Only reset camera fitting if the center page changes (new root graph)
    // Don't reset when just adding nodes (expanding) - camera should stay put
    if (prevCenterPageIdRef.current !== data.center_page_id) {
      setHasFittedCamera(false) // Reset camera fitting only for new root
      prevCenterPageIdRef.current = data.center_page_id
    }
  }, [data.center_page_id])
  
  // Calculate node positions ONCE using ALL nodes and edges (don't recalculate when filters change)
  const nodePositions = useMemo(() => {
    console.log(`[GraphVisualization] Calculating positions for ${nodes.length} nodes, ${edges.length} edges, center=${data.center_page_id}`)
    const positions = calculateNodePositions(nodes, edges, data.center_page_id, expansionHub)
    console.log(`[GraphVisualization] Calculated ${positions.size} positions`)
    // Verify all nodes have positions
    nodes.forEach(node => {
      if (!positions.has(node.page_id)) {
        console.warn(`[GraphVisualization] Node ${node.page_id} (${node.title}) has no position!`)
      }
    })
    return positions
  }, [nodes, edges, data.center_page_id, expansionHub])
  
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
  // Ensure total animation completes within 3 seconds regardless of node count
  const getAnimationStartTime = useCallback((nodeId: number): number | undefined => {
    if (animationStartTimeRef.current === null) {
      return undefined // Not initialized yet
    }
    
    const animationIndex = animationOrder.get(nodeId) ?? 0
    
    // Center node (index 0) starts immediately
    if (animationIndex === 0) {
      return animationStartTimeRef.current
    }
    
    // Calculate delay to ensure all animations complete within 3 seconds
    const animationDuration = 0.8 // 800ms for each node animation
    const totalAnimationWindow = 3.0 // 3 seconds total
    const maxStartTime = totalAnimationWindow - animationDuration // Last node must start by this time
    
    // Count total nodes to animate (excluding center)
    const totalNodesToAnimate = animationOrder.size - 1 // Exclude center node
    
    // Calculate delay between nodes to fit within the window
    // If only one node, start immediately; otherwise distribute evenly
    const delayBetweenNodes = totalNodesToAnimate > 1 
      ? maxStartTime / (totalNodesToAnimate - 1)
      : 0
    
    const startTime = animationStartTimeRef.current + (animationIndex - 1) * delayBetweenNodes
    
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
    // For two-way connections, only show one edge (prefer center->node direction)
    const processedEdges = edges.filter(edge => {
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
    
    // Deduplicate two-way edges: for two-way connections, only keep the center->node edge
    const seenTwoWay = new Set<string>()
    return processedEdges.filter(edge => {
      const isFromCenter = edge.from === centerId
      const isToCenter = edge.to === centerId
      
      if (isFromCenter || isToCenter) {
        const isTwoWay = isFromCenter && edges.some(e => e.from === edge.to && e.to === centerId) ||
                         isToCenter && edges.some(e => e.from === centerId && e.to === edge.from)
        
        if (isTwoWay) {
          // Create a unique key for this two-way connection (use both node IDs, sorted)
          const nodeId = isFromCenter ? edge.to : edge.from
          const key = `${Math.min(centerId, nodeId)}-${Math.max(centerId, nodeId)}`
          
          // Only keep the edge that goes FROM center TO node
          if (isFromCenter) {
            seenTwoWay.add(key)
            return true
          } else {
            // Skip the reverse edge if we've already seen the forward edge
            return !seenTwoWay.has(key)
          }
        }
      }
      
      // For edges not involving center, check if they're two-way and deduplicate
      // Check if this edge has a reverse edge (making it two-way)
      const hasReverse = edges.some(e => e.from === edge.to && e.to === edge.from)
      
      if (hasReverse) {
        // Two-way edge between non-center nodes - only keep one direction
        // Use the edge with the smaller from ID to ensure consistency
        const key = `${Math.min(edge.from, edge.to)}-${Math.max(edge.from, edge.to)}`
        
        if (edge.from < edge.to) {
          // Keep the edge with smaller from ID
          seenTwoWay.add(key)
          return true
        } else {
          // Skip the reverse edge if we've already seen the forward edge
          return !seenTwoWay.has(key)
        }
      }
      
      return true
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
      {/* Position it behind everything and make it very large to catch all clicks */}
      <mesh 
        position={[0, 0, -100]}
        onClick={(e) => {
          e.stopPropagation()
          setSelectedNodeId(null)
          if (onNodeSelect) {
            onNodeSelect(null)
          }
        }}
        onPointerDown={(e) => {
          // Also handle pointer down for more reliable detection
          e.stopPropagation()
        }}
        renderOrder={-999} // Render first so it's behind everything
      >
        <planeGeometry args={[5000, 5000]} />
        <meshBasicMaterial 
          transparent 
          opacity={0} 
          depthWrite={false}
          depthTest={false} // Don't test depth so it always catches clicks
        />
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
        
        // Check if this is an edge between first-degree nodes (not involving center)
        const isFromCenter = edge.from === data.center_page_id
        const isToCenter = edge.to === data.center_page_id
        const isBetweenFirstDegree = firstDegreeNodes.has(edge.from) && firstDegreeNodes.has(edge.to) && !isFromCenter && !isToCenter
        
        // Reduce opacity for edges not in the mesh when mesh is active
        let edgeOpacity = isHighlighted ? 0.8 : 0.3
        if (isMeshActive && !isHighlighted) {
          edgeOpacity = 0.1 // Very low opacity for non-mesh edges when mesh is active
        }
        
        // Reduce contrast for edges between first-degree nodes - make them more transparent
        if (isBetweenFirstDegree) {
          edgeOpacity *= 0.4 // Reduce opacity by 60% for much less contrast
        }
        
        const edgeColor = isHighlighted ? '#eaf0ff' : '#4a5568'
        
        // Determine pulse color and direction based on relationship type
        // Use the same logic as node coloring to ensure consistency
        let pulseColor: string | undefined
        let pulseDirection: 'forward' | 'backward' | 'both' | undefined
        let pulseRadius: number | undefined // Optional custom radius for pulses
        
        if (isHighlighted) {
          // isBetweenFirstDegree already calculated above
          
          if (isFromCenter || isToCenter) {
            // Edge connects to center - determine relationship type using ALL edges
            let relationshipType: 'Two way' | 'Inbound' | 'Outbound' | null = null
            
            if (isFromCenter) {
              // Edge goes from center to node - check if reverse edge exists
              const hasReverse = edges.some(e => e.from === edge.to && e.to === data.center_page_id)
              relationshipType = hasReverse ? 'Two way' : 'Outbound'
            } else if (isToCenter) {
              // Edge goes from node to center - check if reverse edge exists
              const hasReverse = edges.some(e => e.from === data.center_page_id && e.to === edge.from)
              relationshipType = hasReverse ? 'Two way' : 'Inbound'
            }
            
            if (relationshipType === 'Two way') {
              // Two-way: teal/cyan pulse in both directions
              pulseColor = '#4ecdc4'
              pulseDirection = 'both'
            } else if (relationshipType === 'Outbound') {
              // Outbound: light purple pulse from center to node
              pulseColor = '#a78bfa'
              pulseDirection = 'forward'
            } else if (relationshipType === 'Inbound') {
              // Inbound: darker purple pulse from node to center
              pulseColor = '#8b5cf6'
              pulseDirection = 'forward'
            }
          } else if (isBetweenFirstDegree) {
            // Edge between two first-degree nodes (not involving center)
            // Use dim white pulses to maintain color cardinality relative to center node
            // Check if it's two-way
            const hasReverse = edges.some(e => e.from === edge.to && e.to === edge.from)
            
            if (hasReverse) {
              // Two-way between first-degree nodes: very dim white pulses in both directions
              pulseColor = '#555555' // Even dimmer white/gray for less brightness
              pulseDirection = 'both'
              pulseRadius = 0.03 // Smaller radius for white pulses
            } else {
              // One-way between first-degree nodes: very dim white pulse
              pulseColor = '#555555' // Even dimmer white/gray for less brightness
              pulseDirection = 'forward'
              pulseRadius = 0.03 // Smaller radius for white pulses
            }
          }
        }
        
        // Get center position for two-way pulse orientation
        const centerPos = nodePositions.get(data.center_page_id)
        
        return (
          <Edge3D
            key={`edge-${edge.from}-${edge.to}-${data.center_page_id}`}
            fromPos={fromPos}
            toPos={toPos}
            color={edgeColor}
            targetOpacity={edgeOpacity}
            isHighlighted={isHighlighted}
            pulseColor={pulseColor}
            pulseDirection={pulseDirection}
            centerPos={centerPos}
            pulseRadius={pulseRadius}
            onDeselect={() => {
              setSelectedNodeId(null)
              if (onNodeSelect) {
                onNodeSelect(null)
              }
            }}
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
          // Use ALL edges (not filtered) to get accurate relationship type regardless of filters
          let relationshipType: 'Two way' | 'Inbound' | 'Outbound' | null = null
          if (isFirstDegree && !node.is_center) {
            const hasOutbound = edges.some(e => e.from === data.center_page_id && e.to === node.page_id)
            const hasInbound = edges.some(e => e.to === data.center_page_id && e.from === node.page_id)
            
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
              onDoubleClick={(e) => {
                e.stopPropagation()
                // Double-click expands the graph with this node's 1st-degree connections
                if (onNodeDoubleClick) {
                  onNodeDoubleClick(node.page_id)
                }
              }}
            />
          )
        })
      })()}
      
      <AutoRotatingOrbitControls 
        isInteracting={isUserInteracting}
        nodePositions={nodePositions}
        shouldRefit={!hasFittedCamera}
        onFitted={() => setHasFittedCamera(true)}
      />
    </Canvas>
  )
}
