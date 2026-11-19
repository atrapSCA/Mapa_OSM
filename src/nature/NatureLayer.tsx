import { useMemo } from 'react'
import * as THREE from 'three'
import type {
  ContinuousTerrainJson,
  NatureLayerJson,
  NaturePolygon,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { drapePolygonGeometry, mergeGeometries } from '@/geo/drapePolygon'
import { useLayers } from '@/store/layers'

/**
 * Same draping as water polygons: densified OSM outline + DEM heights.
 * Lift below water (~1.6) so lakes cover forests inside shorelines.
 */
const LIFT = 0.85

const NATURE_COLORS: Record<string, string> = {
  forest: '#1e5c2a',
  scrub: '#4d6e32',
  grassland: '#6fbf45',
  heath: '#7d9140',
  farmland: '#d4c04a',
  orchard: '#5f9638',
  vineyard: '#5a8438',
  wetland: '#5a6e3a',
  park: '#3d9a48',
  cemetery: '#5a6e4a',
  allotments: '#7aad40',
  sand: '#e0d090',
  bare_rock: '#a8a298',
}

function NatureKindMesh({
  kind,
  polygons,
  terrain,
  exaggeration,
}: {
  kind: string
  polygons: NaturePolygon[]
  terrain: ContinuousTerrainJson
  exaggeration: number
}) {
  const geometry = useMemo(() => {
    const geos: THREE.BufferGeometry[] = []
    for (const p of polygons) {
      const g = drapePolygonGeometry(p.rings, terrain, exaggeration, LIFT)
      if (g) geos.push(g)
    }
    return mergeGeometries(geos)
  }, [polygons, terrain, exaggeration])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={0}>
      <meshStandardMaterial
        color={NATURE_COLORS[kind] ?? '#5a8a4a'}
        flatShading
        roughness={0.92}
        metalness={0.02}
        side={THREE.DoubleSide}
        depthWrite
        depthTest
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
      />
    </mesh>
  )
}

export function NatureLayer({
  nature,
  terrain,
}: {
  nature: NatureLayerJson
  terrain: ContinuousTerrainJson
}) {
  const show = useLayers((s) => s.nature)
  const areaStyle = useLayers((s) => s.areaStyle)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  const isKindOn = useLayers((s) => s.isKindOn)
  const exaggeration = useLayers((s) => s.verticalExaggeration)

  // V2 paints nature into terrain landcover texture — no separate meshes.
  const useDrape = areaStyle === 'v1-drape'

  const byKind = useMemo(() => {
    if (!show || !useDrape) return [] as [string, NaturePolygon[]][]
    const map = new Map<string, NaturePolygon[]>()
    for (const p of nature.polygons) {
      const k = normalizeKind(p.kind)
      if (!isKindOn('nature', k)) continue
      const list = map.get(k)
      if (list) list.push(p)
      else map.set(k, [p])
    }
    return [...map.entries()]
  }, [show, useDrape, nature.polygons, kindEnabled, isKindOn])

  if (!show || !useDrape || byKind.length === 0) return null

  return (
    <group>
      {byKind.map(([kind, polys]) => (
        <NatureKindMesh
          key={`nature-${kind}`}
          kind={kind}
          polygons={polys}
          terrain={terrain}
          exaggeration={exaggeration}
        />
      ))}
    </group>
  )
}
