import { useEffect, useState } from 'react'
import type {
  ContinuousTerrainJson,
  NatureLayerJson,
  RegionManifest,
  RoadLayerJson,
  WaterLayerJson,
} from '@shared/tileFormat'

export type LoadedRegion = {
  manifest: RegionManifest
  terrain: ContinuousTerrainJson
  water: WaterLayerJson | null
  roads: RoadLayerJson | null
  nature: NatureLayerJson | null
}

export function useRegionManifest(regionId: string) {
  const [data, setData] = useState<LoadedRegion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const base = `/tiles/${regionId}`
        const manRes = await fetch(`${base}/manifest.json`)
        if (!manRes.ok) {
          throw new Error(
            `Chybí manifest (${manRes.status}). Spusť: npm run pipeline:rakovnik`,
          )
        }
        const manifest = (await manRes.json()) as RegionManifest
        const contPath = manifest.continuousPath ?? 'terrain/continuous.json'
        const terrainRes = await fetch(`${base}/${contPath}`)
        if (!terrainRes.ok) {
          throw new Error(
            `Chybí continuous mesh (${terrainRes.status}). Spusť znovu: npm run pipeline:rakovnik`,
          )
        }
        const terrain = (await terrainRes.json()) as ContinuousTerrainJson

        let water: WaterLayerJson | null = null
        if (manifest.waterPath) {
          const waterRes = await fetch(`${base}/${manifest.waterPath}`)
          if (waterRes.ok) {
            water = (await waterRes.json()) as WaterLayerJson
          }
        }

        let roads: RoadLayerJson | null = null
        if (manifest.roadsPath) {
          const roadsRes = await fetch(`${base}/${manifest.roadsPath}`)
          if (roadsRes.ok) {
            roads = (await roadsRes.json()) as RoadLayerJson
          }
        }

        let nature: NatureLayerJson | null = null
        if (manifest.naturePath) {
          const natureRes = await fetch(`${base}/${manifest.naturePath}`)
          if (natureRes.ok) {
            nature = (await natureRes.json()) as NatureLayerJson
          }
        }

        if (!cancelled) setData({ manifest, terrain, water, roads, nature })
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [regionId])

  return { data, error, loading }
}
