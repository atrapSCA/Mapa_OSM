import { useMemo } from 'react'
import type {
  ContinuousTerrainJson,
  WaterLayerJson,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { ribbonGeometry } from '@/geo/ribbonGeometry'
import { clipPolylineOutsidePolygons } from '@/geo/clipPolyline'
import { useLayers } from '@/store/layers'

const WATER_COLOR = '#6eb4d4'
const LIFT_WAY = 0.4

const WATERWAY_COLORS: Record<string, string> = {
  river: '#5aa8c8',
  stream: '#7eb8d4',
  canal: '#6a9cbc',
  drain: '#8ab8c8',
  ditch: '#9ac0c8',
}

function WaterwayMesh({
  points,
  width,
  terrain,
  exaggeration,
  color,
}: {
  points: [number, number][]
  width: number
  terrain: ContinuousTerrainJson
  exaggeration: number
  color: string
}) {
  const geometry = useMemo(
    () => ribbonGeometry(points, width, terrain, exaggeration, LIFT_WAY),
    [points, width, terrain, exaggeration],
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

/** Water polygons → terrain texture; ribbons clipped so they vanish under lakes. */
export function WaterLayer({
  water,
  terrain,
}: {
  water: WaterLayerJson
  terrain: ContinuousTerrainJson
}) {
  const showWater = useLayers((s) => s.water)
  const showWays = useLayers((s) => s.waterways)
  const showPolygons = useLayers((s) => s.waterPolygons)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  const isKindOn = useLayers((s) => s.isKindOn)
  const exaggeration = useLayers((s) => s.verticalExaggeration)

  const lakePolys = useMemo(() => {
    if (!showPolygons) return []
    return water.polygons.filter((p) =>
      isKindOn('waterPolygons', normalizeKind(p.kind)),
    )
  }, [showPolygons, water.polygons, kindEnabled, isKindOn])

  const ribbonSegments = useMemo(() => {
    if (!showWater || !showWays) return [] as {
      id: string
      points: [number, number][]
      width: number
      kind: string
    }[]

    const out: {
      id: string
      points: [number, number][]
      width: number
      kind: string
    }[] = []

    for (const w of water.waterways) {
      if (!isKindOn('waterways', normalizeKind(w.kind))) continue
      const parts = clipPolylineOutsidePolygons(w.points, lakePolys)
      parts.forEach((pts, i) => {
        out.push({
          id: `${w.id}-${i}`,
          points: pts,
          width: w.width,
          kind: w.kind,
        })
      })
    }
    return out
  }, [
    showWater,
    showWays,
    water.waterways,
    lakePolys,
    kindEnabled,
    isKindOn,
  ])

  if (!showWater || ribbonSegments.length === 0) return null

  return (
    <group>
      {ribbonSegments.map((seg) => (
        <WaterwayMesh
          key={seg.id}
          points={seg.points}
          width={seg.width}
          terrain={terrain}
          exaggeration={exaggeration}
          color={WATERWAY_COLORS[normalizeKind(seg.kind)] ?? WATER_COLOR}
        />
      ))}
    </group>
  )
}
