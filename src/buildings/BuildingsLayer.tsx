import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type {
  BuildingLayerJson,
  ContinuousTerrainJson,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { useLayers } from '@/store/layers'
import { useSelection } from '@/store/selection'
import {
  buildingBaseY,
  buildingGeometry,
} from './buildingGeom'
import { BuildingBubble } from './BuildingBubble'
import {
  createRoofGeometry,
  roofRiseMeters,
  roofShapeForBuilding,
} from './roofs'
import { getSkinMaterial, presetForKind } from './skins'

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

const highlightMat = new THREE.MeshStandardMaterial({
  color: '#f0e6a8',
  emissive: '#6a5a20',
  emissiveIntensity: 0.35,
  flatShading: true,
  roughness: 0.75,
  metalness: 0.05,
})

function ClickMesh({
  buildingId,
  geometry,
  materials,
  selected,
  onSelect,
}: {
  buildingId: string
  geometry: THREE.BufferGeometry
  materials: THREE.Material | THREE.Material[]
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
    onSelect(buildingId)
  }

  return (
    <mesh
      name={buildingId}
      geometry={geometry}
      material={selected ? highlightMat : materials}
      userData={{ buildingId }}
      frustumCulled
      castShadow={false}
      onPointerDown={onPointerDown}
      onClick={onClick}
    />
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
  const skinsOn = useLayers((s) => s.buildingSkins)
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

  const parts = useMemo(() => {
    const map = new Map<
      string,
      { walls: THREE.BufferGeometry; roof: THREE.BufferGeometry | null }
    >()
    for (const b of visible) {
      const shape = roofShapeForBuilding(b)
      const riseM = roofRiseMeters(b, shape)
      const fullH = Math.max(2.5, Math.min(80, b.height))
      // Pitched roofs sit on eaves; walls stop below the ridge.
      const wallH =
        shape === 'flat' ? fullH : Math.max(2.2, fullH - riseM * 0.85)
      const walls = buildingGeometry(b, terrain, exaggeration, wallH, true)
      if (!walls) continue

      const baseY = buildingBaseY(b, terrain, exaggeration)
      const yEaves = baseY + wallH * exaggeration
      const roof = createRoofGeometry(
        b.rings[0],
        yEaves,
        shape,
        riseM * exaggeration,
      )
      map.set(b.id, { walls, roof })
    }
    return map
  }, [visible, terrain, exaggeration])

  const flatMaterials = useMemo(() => {
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

  /** Contrasting roof colours when skins off — slopes must read clearly. */
  const flatRoofMaterials = useMemo(() => {
    const roofColors: Record<string, string> = {
      house: '#8b3a2a',
      apartments: '#6a5a52',
      building: '#7a4a3a',
      commercial: '#5a5850',
      industrial: '#4a5058',
      church: '#5a4038',
      public: '#6a5848',
      garage: '#555860',
      farm: '#6a4028',
    }
    const map = new Map<string, THREE.MeshStandardMaterial>()
    for (const b of visible) {
      const k = normalizeKind(b.kind)
      if (map.has(k)) continue
      map.set(
        k,
        new THREE.MeshStandardMaterial({
          color: roofColors[k] ?? '#6a4030',
          flatShading: true,
          roughness: 0.92,
          metalness: 0.05,
        }),
      )
    }
    return map
  }, [visible])

  useEffect(() => {
    return () => {
      for (const p of parts.values()) {
        p.walls.dispose()
        p.roof?.dispose()
      }
    }
  }, [parts])

  useEffect(() => {
    return () => {
      for (const m of flatMaterials.values()) m.dispose()
      for (const m of flatRoofMaterials.values()) m.dispose()
    }
  }, [flatMaterials, flatRoofMaterials])

  if (!show) return null

  const selected = selectedId
    ? (visible.find((b) => b.id === selectedId) ?? null)
    : null

  return (
    <group>
      {visible.map((b) => {
        const part = parts.get(b.id)
        if (!part) return null
        const kind = normalizeKind(b.kind)
        const selected = b.id === selectedId

        let wallMat: THREE.Material
        let roofMat: THREE.Material
        if (skinsOn) {
          const preset = presetForKind(kind)
          wallMat = getSkinMaterial(preset.wall, 'wall')
          roofMat = getSkinMaterial(preset.roof, 'roof')
        } else {
          wallMat = flatMaterials.get(kind)!
          roofMat = flatRoofMaterials.get(kind)!
        }

        return (
          <group key={b.id}>
            <ClickMesh
              buildingId={b.id}
              geometry={part.walls}
              materials={wallMat}
              selected={selected}
              onSelect={select}
            />
            {part.roof && (
              <ClickMesh
                buildingId={b.id}
                geometry={part.roof}
                materials={roofMat}
                selected={selected}
                onSelect={select}
              />
            )}
          </group>
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
