import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type {
  Building,
  BuildingLayerJson,
  ContinuousTerrainJson,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { useLayers } from '@/store/layers'
import { useSelection } from '@/store/selection'
import { buildingGeometry } from './buildingGeom'
import { BuildingBubble } from './BuildingBubble'

const BUILDING_COLORS: Record<string, string> = {
  building: '#d4cfc4',
  house: '#e0d5c4',
  apartments: '#c8c0b4',
  industrial: '#a8a098',
  commercial: '#d8cfc0',
  church: '#c4b8a8',
  public: '#d0c8b8',
  garage: '#b8b0a4',
  farm: '#c4b8a0',
}

const CLICK_MAX_MOVE_PX = 4

function BuildingMesh({
  building,
  geometry,
  material,
  selected,
  onSelect,
}: {
  building: Building
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  selected: boolean
  onSelect: (id: string) => void
}) {
  const down = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    down.current = { x: e.clientX, y: e.clientY }
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const d = down.current
    down.current = null
    if (d) {
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y)
      if (dist > CLICK_MAX_MOVE_PX) return
    }
    onSelect(building.id)
  }

  return (
    <mesh
      name={building.id}
      geometry={geometry}
      material={material}
      userData={{ buildingId: building.id }}
      frustumCulled
      castShadow={false}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {selected && (
        <meshStandardMaterial
          color="#f0e6a8"
          emissive="#6a5a20"
          emissiveIntensity={0.35}
          flatShading
          roughness={0.75}
          metalness={0.05}
        />
      )}
    </mesh>
  )
}

export function BuildingsLayer({
  buildings,
  terrain,
}: {
  buildings: BuildingLayerJson
  terrain: ContinuousTerrainJson
}) {
  const show = useLayers((s) => s.buildings)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  const isKindOn = useLayers((s) => s.isKindOn)
  const exaggeration = useLayers((s) => s.verticalExaggeration)
  const selectedId = useSelection((s) => s.selectedId)
  const select = useSelection((s) => s.select)
  void kindEnabled

  const visible = useMemo(() => {
    return buildings.buildings.filter((b) =>
      isKindOn('buildings', normalizeKind(b.kind)),
    )
  }, [buildings.buildings, isKindOn, kindEnabled])

  const geos = useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>()
    for (const b of visible) {
      const g = buildingGeometry(b, terrain, exaggeration)
      if (g) map.set(b.id, g)
    }
    return map
  }, [visible, terrain, exaggeration])

  const materials = useMemo(() => {
    const map = new Map<string, THREE.MeshStandardMaterial>()
    for (const b of visible) {
      const k = normalizeKind(b.kind)
      if (map.has(k)) continue
      map.set(
        k,
        new THREE.MeshStandardMaterial({
          color: BUILDING_COLORS[k] ?? BUILDING_COLORS.building,
          flatShading: true,
          roughness: 0.88,
          metalness: 0.04,
        }),
      )
    }
    return map
  }, [visible])

  useEffect(() => {
    return () => {
      for (const g of geos.values()) g.dispose()
    }
  }, [geos])

  useEffect(() => {
    return () => {
      for (const m of materials.values()) m.dispose()
    }
  }, [materials])

  if (!show) return null

  const selected = selectedId
    ? (visible.find((b) => b.id === selectedId) ?? null)
    : null

  return (
    <group>
      {visible.map((b) => {
        const geo = geos.get(b.id)
        if (!geo) return null
        const kind = normalizeKind(b.kind)
        const mat = materials.get(kind)
        if (!mat) return null
        return (
          <BuildingMesh
            key={b.id}
            building={b}
            geometry={geo}
            material={mat}
            selected={b.id === selectedId}
            onSelect={select}
          />
        )
      })}
      {selected && (
        <BuildingBubble
          building={selected}
          terrain={terrain}
          exaggeration={exaggeration}
        />
      )}
    </group>
  )
}
