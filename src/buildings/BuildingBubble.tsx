import { useEffect, useMemo, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { Building, ContinuousTerrainJson } from '@shared/tileFormat'
import { labelFor } from '@shared/osmLabels'
import { useSelection } from '@/store/selection'
import { buildingWorldCorners, ringAreaAbs } from './buildingGeom'
import { roofShapeForBuilding } from './roofs'

const MARGIN = 14
const BUBBLE_W = 220

function BubbleCard({
  building,
  area,
  kindLabel,
  roofShape,
  onClose,
}: {
  building: Building
  area: number
  kindLabel: string
  roofShape: string
  onClose: () => void
}) {
  return (
    <div className="building-bubble" role="dialog" aria-label="Budova">
      <button
        type="button"
        className="building-bubble-close"
        aria-label="Zavřít"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
      <div className="building-bubble-title">
        {building.name?.trim() || 'Bez názvu'}
      </div>
      <dl className="building-bubble-meta">
        <div>
          <dt>ID</dt>
          <dd>{building.id}</dd>
        </div>
        <div>
          <dt>Typ</dt>
          <dd>{kindLabel}</dd>
        </div>
        <div>
          <dt>Výška</dt>
          <dd>{building.height.toFixed(1)} m</dd>
        </div>
        <div>
          <dt>Plocha</dt>
          <dd>{area.toLocaleString('cs-CZ')} m²</dd>
        </div>
        <div>
          <dt>Střecha</dt>
          <dd>{roofShape}</dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Tracks building AABB → screen and mounts the card in a *separate* React root
 * on the viewport. Must not return createPortal into the R3F tree (crashes Canvas).
 */
export function BuildingBubble({
  building,
  terrain,
  exaggeration,
}: {
  building: Building
  terrain: ContinuousTerrainJson
  exaggeration: number
}) {
  const clear = useSelection((s) => s.clear)
  const { camera, size, gl } = useThree()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<Root | null>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])

  const corners = useMemo(
    () => buildingWorldCorners(building, terrain, exaggeration),
    [building, terrain, exaggeration],
  )

  const area = Math.round(ringAreaAbs(building.rings[0] ?? []))
  const kindLabel = labelFor('buildings', building.kind)
  const roofShape = roofShapeForBuilding(building)

  useEffect(() => {
    const host = gl.domElement.parentElement
    if (!host) return

    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative'
    }

    const layer = document.createElement('div')
    layer.className = 'building-bubble-layer'
    layer.style.visibility = 'hidden'
    host.appendChild(layer)
    layerRef.current = layer

    const root = createRoot(layer)
    rootRef.current = root
    root.render(
      <BubbleCard
        building={building}
        area={area}
        kindLabel={kindLabel}
        roofShape={roofShape}
        onClose={clear}
      />,
    )

    // Card is the first child after React commits
    requestAnimationFrame(() => {
      cardRef.current = layer.querySelector('.building-bubble')
    })

    return () => {
      root.unmount()
      rootRef.current = null
      layer.remove()
      layerRef.current = null
      cardRef.current = null
    }
  }, [gl, building, area, kindLabel, roofShape, clear])

  useFrame(() => {
    const layer = layerRef.current
    if (!layer || corners.length === 0) return

    let minSX = Infinity
    let maxSX = -Infinity
    let minSY = Infinity
    let maxSY = -Infinity
    let any = false

    for (const c of corners) {
      tmp.copy(c).project(camera)
      if (tmp.z < -1 || tmp.z > 1) continue
      const sx = (tmp.x * 0.5 + 0.5) * size.width
      const sy = (-tmp.y * 0.5 + 0.5) * size.height
      minSX = Math.min(minSX, sx)
      maxSX = Math.max(maxSX, sx)
      minSY = Math.min(minSY, sy)
      maxSY = Math.max(maxSY, sy)
      any = true
    }

    if (!any) {
      layer.style.visibility = 'hidden'
      return
    }

    const card = cardRef.current ?? layer.querySelector('.building-bubble')
    if (card instanceof HTMLElement) cardRef.current = card
    const cardW = cardRef.current?.offsetWidth || BUBBLE_W
    const cardH = cardRef.current?.offsetHeight || 120
    const midY = (minSY + maxSY) * 0.5

    let side: 'right' | 'left' = 'right'
    let left = maxSX + MARGIN
    if (left + cardW > size.width - 8) {
      side = 'left'
      left = minSX - MARGIN - cardW
    }
    left = Math.max(8, Math.min(left, size.width - cardW - 8))

    let top = midY - cardH * 0.5
    top = Math.max(8, Math.min(top, size.height - cardH - 8))

    layer.dataset.side = side
    layer.style.visibility = 'visible'
    layer.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  })

  return null
}
