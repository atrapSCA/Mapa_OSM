import { useEffect, useMemo } from 'react'
import type {
  ContinuousTerrainJson,
  NatureLayerJson,
  WaterLayerJson,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { continuousTerrainToGeometry } from './buildGeometry'
import {
  buildLandcoverTexture,
  type LandcoverPoly,
} from './landcoverTexture'
import { useLayers } from '@/store/layers'

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

const WATER_COLORS: Record<string, string> = {
  water: '#6eb4d4',
  lake: '#6eb4d4',
  pond: '#6eb4d4',
  basin: '#6eb4d4',
  reservoir: '#4a9bb8',
}

export function TerrainMesh({
  terrain,
  nature,
  water,
}: {
  terrain: ContinuousTerrainJson
  nature?: NatureLayerJson | null
  water?: WaterLayerJson | null
}) {
  const show = useLayers((s) => s.terrain)
  const hypsometric = useLayers((s) => s.hypsometric)
  const wireframe = useLayers((s) => s.wireframe)
  const flatShading = useLayers((s) => s.flatShading)
  const verticalExaggeration = useLayers((s) => s.verticalExaggeration)
  const areaStyle = useLayers((s) => s.areaStyle)
  const showNature = useLayers((s) => s.nature)
  const showWater = useLayers((s) => s.water)
  const showWaterPolygons = useLayers((s) => s.waterPolygons)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  const isKindOn = useLayers((s) => s.isKindOn)

  const geometry = useMemo(
    () =>
      continuousTerrainToGeometry(terrain, verticalExaggeration, hypsometric),
    [terrain, verticalExaggeration, hypsometric],
  )

  const naturePolys = useMemo((): LandcoverPoly[] => {
    if (areaStyle !== 'v2-texture' || !showNature || !nature) return []
    const out: LandcoverPoly[] = []
    for (const p of nature.polygons) {
      const k = normalizeKind(p.kind)
      if (!isKindOn('nature', k)) continue
      out.push({
        rings: p.rings,
        color: NATURE_COLORS[k] ?? '#5a8a4a',
      })
    }
    return out
  }, [areaStyle, showNature, nature, kindEnabled, isKindOn])

  const waterPolys = useMemo((): LandcoverPoly[] => {
    if (
      areaStyle !== 'v2-texture' ||
      !showWater ||
      !showWaterPolygons ||
      !water
    ) {
      return []
    }
    const out: LandcoverPoly[] = []
    for (const p of water.polygons) {
      const k = normalizeKind(p.kind)
      if (!isKindOn('waterPolygons', k)) continue
      out.push({
        rings: p.rings,
        color: WATER_COLORS[k] ?? WATER_COLORS.water,
      })
    }
    return out
  }, [
    areaStyle,
    showWater,
    showWaterPolygons,
    water,
    kindEnabled,
    isKindOn,
  ])

  const landcoverMap = useMemo(() => {
    if (areaStyle !== 'v2-texture') return null
    return buildLandcoverTexture(
      terrain,
      naturePolys,
      waterPolys,
      hypsometric,
    )
  }, [areaStyle, terrain, naturePolys, waterPolys, hypsometric])

  useEffect(() => {
    return () => {
      landcoverMap?.dispose()
    }
  }, [landcoverMap])

  if (!show) return null

  const useTexture = areaStyle === 'v2-texture' && landcoverMap

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshStandardMaterial
        map={useTexture ? landcoverMap : null}
        vertexColors={!useTexture}
        flatShading={flatShading}
        wireframe={wireframe}
        roughness={0.92}
        metalness={0.02}
      />
    </mesh>
  )
}
