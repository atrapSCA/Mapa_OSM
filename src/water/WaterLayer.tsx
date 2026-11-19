import { useMemo } from 'react'
import * as THREE from 'three'
import type {
  ContinuousTerrainJson,
  WaterLayerJson,
  WaterPolygon,
  Waterway,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { ribbonGeometry } from '@/geo/ribbonGeometry'
import { drapePolygonGeometry, mergeGeometries } from '@/geo/drapePolygon'
import { useLayers } from '@/store/layers'

const WATER_COLOR = '#6eb4d4'
const WATER_COLOR_DEEP = '#4a9bb8'
const LIFT_WAY = 1.35
const LIFT_POLY = 1.6

const WATERWAY_COLORS: Record<string, string> = {
  river: '#5aa8c8',
  stream: '#7eb8d4',
  canal: '#6a9cbc',
  drain: '#8ab8c8',
  ditch: '#9ac0c8',
}

function WaterwayMesh({
  way,
  terrain,
  exaggeration,
  color,
}: {
  way: Waterway
  terrain: ContinuousTerrainJson
  exaggeration: number
  color: string
}) {
  const geometry = useMemo(
    () =>
      ribbonGeometry(way.points, way.width, terrain, exaggeration, LIFT_WAY),
    [way, terrain, exaggeration],
  )
  if (!geometry) return null
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={1}>
      <meshStandardMaterial
        color={color}
        roughness={0.35}
        metalness={0.05}
        flatShading
        transparent
        opacity={0.88}
        depthWrite={false}
        depthTest
        polygonOffset
        polygonOffsetFactor={-10}
        polygonOffsetUnits={-10}
      />
    </mesh>
  )
}

function WaterPolygonsMesh({
  polygons,
  terrain,
  exaggeration,
  color,
}: {
  polygons: WaterPolygon[]
  terrain: ContinuousTerrainJson
  exaggeration: number
  color: string
}) {
  const geometry = useMemo(() => {
    const geos: THREE.BufferGeometry[] = []
    for (const p of polygons) {
      const g = drapePolygonGeometry(p.rings, terrain, exaggeration, LIFT_POLY)
      if (g) geos.push(g)
    }
    return mergeGeometries(geos)
  }, [polygons, terrain, exaggeration])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={2}>
      <meshStandardMaterial
        color={color}
        roughness={0.3}
        metalness={0.08}
        flatShading
        transparent
        opacity={0.9}
        depthWrite
        depthTest
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-12}
        polygonOffsetUnits={-12}
      />
    </mesh>
  )
}

export function WaterLayer({
  water,
  terrain,
}: {
  water: WaterLayerJson
  terrain: ContinuousTerrainJson
}) {
  const showWater = useLayers((s) => s.water)
  const showPolygons = useLayers((s) => s.waterPolygons)
  const showWays = useLayers((s) => s.waterways)
  const areaStyle = useLayers((s) => s.areaStyle)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  const isKindOn = useLayers((s) => s.isKindOn)
  const exaggeration = useLayers((s) => s.verticalExaggeration)

  // V2 bakes water polygons into terrain texture; ribbons stay in both modes.
  const drapePolygons = areaStyle === 'v1-drape'

  const visibleWays = useMemo(() => {
    if (!showWater || !showWays) return [] as Waterway[]
    return water.waterways.filter((w) =>
      isKindOn('waterways', normalizeKind(w.kind)),
    )
  }, [showWater, showWays, water.waterways, kindEnabled, isKindOn])

  const polygonsByKind = useMemo(() => {
    if (!showWater || !showPolygons || !drapePolygons) {
      return [] as [string, WaterPolygon[]][]
    }
    const map = new Map<string, WaterPolygon[]>()
    for (const p of water.polygons) {
      const k = normalizeKind(p.kind)
      if (!isKindOn('waterPolygons', k)) continue
      const list = map.get(k)
      if (list) list.push(p)
      else map.set(k, [p])
    }
    return [...map.entries()]
  }, [
    showWater,
    showPolygons,
    drapePolygons,
    water.polygons,
    kindEnabled,
    isKindOn,
  ])

  if (!showWater) return null
  if (visibleWays.length === 0 && polygonsByKind.length === 0) return null

  return (
    <group>
      {visibleWays.map((w) => (
        <WaterwayMesh
          key={w.id}
          way={w}
          terrain={terrain}
          exaggeration={exaggeration}
          color={WATERWAY_COLORS[normalizeKind(w.kind)] ?? WATER_COLOR}
        />
      ))}
      {polygonsByKind.map(([kind, polys]) => (
        <WaterPolygonsMesh
          key={`poly-${kind}`}
          polygons={polys}
          terrain={terrain}
          exaggeration={exaggeration}
          color={kind === 'reservoir' ? WATER_COLOR_DEEP : WATER_COLOR}
        />
      ))}
    </group>
  )
}
