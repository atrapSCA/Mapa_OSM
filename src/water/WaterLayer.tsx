import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type {
  ContinuousTerrainJson,
  WaterLayerJson,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { mergeRibbons } from '@/geo/ribbonGeometry'
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

  /** One merged ribbon mesh per waterway colour (was 1 mesh per segment). */
  const colorBatches = useMemo(() => {
    if (!showWater || !showWays) {
      return [] as { color: string; geometry: THREE.BufferGeometry }[]
    }

    const byColor = new Map<
      string,
      { points: [number, number][]; width: number }[]
    >()

    for (const w of water.waterways) {
      if (!isKindOn('waterways', normalizeKind(w.kind))) continue
      const color =
        WATERWAY_COLORS[normalizeKind(w.kind)] ?? WATER_COLOR
      const parts = clipPolylineOutsidePolygons(w.points, lakePolys)
      let list = byColor.get(color)
      if (!list) {
        list = []
        byColor.set(color, list)
      }
      for (const pts of parts) {
        list.push({ points: pts, width: w.width })
      }
    }

    const out: { color: string; geometry: THREE.BufferGeometry }[] = []
    for (const [color, segs] of byColor) {
      const geometry = mergeRibbons(segs, terrain, exaggeration, LIFT_WAY)
      if (geometry) out.push({ color, geometry })
    }
    return out
  }, [
    showWater,
    showWays,
    water.waterways,
    lakePolys,
    kindEnabled,
    isKindOn,
    terrain,
    exaggeration,
  ])

  useEffect(() => {
    return () => {
      for (const b of colorBatches) b.geometry.dispose()
    }
  }, [colorBatches])

  if (!showWater || colorBatches.length === 0) return null

  return (
    <group>
      {colorBatches.map((b) => (
        <mesh
          key={b.color}
          geometry={b.geometry}
          frustumCulled={false}
          renderOrder={1}
        >
          <meshStandardMaterial
            color={b.color}
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
      ))}
    </group>
  )
}
