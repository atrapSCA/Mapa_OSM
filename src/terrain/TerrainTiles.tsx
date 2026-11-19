import { useMemo } from 'react'
import type { ContinuousTerrainJson } from '@shared/tileFormat'
import { continuousTerrainToGeometry } from './buildGeometry'
import { useLayers } from '@/store/layers'

export function TerrainMesh({
  terrain,
}: {
  terrain: ContinuousTerrainJson
}) {
  const show = useLayers((s) => s.terrain)
  const hypsometric = useLayers((s) => s.hypsometric)
  const wireframe = useLayers((s) => s.wireframe)
  const flatShading = useLayers((s) => s.flatShading)
  const verticalExaggeration = useLayers((s) => s.verticalExaggeration)

  const geometry = useMemo(
    () =>
      continuousTerrainToGeometry(terrain, verticalExaggeration, hypsometric),
    [terrain, verticalExaggeration, hypsometric],
  )

  if (!show) return null

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshStandardMaterial
        vertexColors
        flatShading={flatShading}
        wireframe={wireframe}
        roughness={0.92}
        metalness={0.02}
      />
    </mesh>
  )
}
