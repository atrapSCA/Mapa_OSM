import { useEffect, useState } from 'react'
import type {
  ContinuousTerrainJson,
  RegionManifest,
} from '@shared/tileFormat'

export type LoadedRegion = {
  manifest: RegionManifest
  terrain: ContinuousTerrainJson
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
        if (!cancelled) setData({ manifest, terrain })
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
