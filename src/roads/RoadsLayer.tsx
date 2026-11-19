import { useMemo } from 'react'
import type {
  ContinuousTerrainJson,
  RoadLayerJson,
  RoadSegment,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { mergeRibbons } from '@/geo/ribbonGeometry'
import { useLayers } from '@/store/layers'

/** One asphalt tone for the whole road network (no darker overlap seams). */
const ROAD_COLOR = '#5a5650'
const PATH_COLOR = '#d2c4a0'

function RoadGroupMesh({
  segments,
  terrain,
  exaggeration,
  color,
  lift,
  renderOrder,
}: {
  segments: RoadSegment[]
  terrain: ContinuousTerrainJson
  exaggeration: number
  color: string
  lift: number
  renderOrder: number
}) {
  const geometry = useMemo(
    () =>
      mergeRibbons(
        segments.map((s) => ({ points: s.points, width: s.width })),
        terrain,
        exaggeration,
        lift,
      ),
    [segments, terrain, exaggeration, lift],
  )
  if (!geometry) return null
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={renderOrder}>
      {/* Unlit + depthWrite: overlaps stay the same solid color */}
      <meshBasicMaterial
        color={color}
        depthWrite
        depthTest
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

export function RoadsLayer({
  roads,
  terrain,
}: {
  roads: RoadLayerJson
  terrain: ContinuousTerrainJson
}) {
  const showRoads = useLayers((s) => s.roads)
  const showPaths = useLayers((s) => s.paths)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  const isKindOn = useLayers((s) => s.isKindOn)
  const exaggeration = useLayers((s) => s.verticalExaggeration)
  void kindEnabled

  const roadSegments = useMemo(() => {
    if (!showRoads) return [] as RoadSegment[]
    return roads.roads.filter((s) => isKindOn('roads', normalizeKind(s.kind)))
  }, [roads.roads, showRoads, isKindOn, kindEnabled])

  const pathSegments = useMemo(() => {
    if (!showPaths) return [] as RoadSegment[]
    return roads.paths.filter((s) => isKindOn('paths', normalizeKind(s.kind)))
  }, [roads.paths, showPaths, isKindOn, kindEnabled])

  return (
    <group>
      {/* Paths first / lower — always under roads at crossings */}
      {pathSegments.length > 0 && (
        <RoadGroupMesh
          segments={pathSegments}
          terrain={terrain}
          exaggeration={exaggeration}
          color={PATH_COLOR}
          lift={1.55}
          renderOrder={1}
        />
      )}
      {roadSegments.length > 0 && (
        <RoadGroupMesh
          segments={roadSegments}
          terrain={terrain}
          exaggeration={exaggeration}
          color={ROAD_COLOR}
          lift={2.25}
          renderOrder={2}
        />
      )}
    </group>
  )
}
