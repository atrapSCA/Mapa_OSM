/**
 * Build low-poly terrain for a region.
 *
 * DEM is still fetched as slippy tiles (world-scalable), but the viewer mesh
 * is one continuous grid over the bbox — no square seams between tiles.
 *
 * Usage:
 *   npm run pipeline:rakovnik
 *   npx tsx scripts/build-region.ts --region rakovnik
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REGIONS,
  bboxFromCenter,
  tilesCoveringBBox,
  tileToBBox,
  lonLatToTile,
  lonLatToLocalMeters,
  type BBox,
  type RegionId,
  type TileCoord,
} from '../shared/geo.ts'
import { elevationToRgb, rgbToHex } from '../shared/hypsometric.ts'
import type {
  ContinuousTerrainJson,
  RegionManifest,
} from '../shared/tileFormat.ts'
import { loadOrFetchDem, sampleHeight, writeJson } from './dem.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data')

type DemGrid = { width: number; height: number; heights: Float32Array }

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const regionFlag = get('--region') as RegionId | undefined
  if (regionFlag && regionFlag in REGIONS) {
    const r = REGIONS[regionFlag]
    return {
      id: r.id,
      name: r.name,
      lon: r.center.lon,
      lat: r.center.lat,
      size: r.sizeMeters,
      zoom: r.zoom,
      meshResolution: r.meshResolution,
      verticalExaggeration: r.verticalExaggeration,
    }
  }
  return {
    id: get('--id') ?? 'custom',
    name: get('--name') ?? 'Custom region',
    lon: Number(get('--lon') ?? 13.7333),
    lat: Number(get('--lat') ?? 50.1042),
    size: Number(get('--size') ?? 10_000),
    zoom: Number(get('--zoom') ?? 13),
    meshResolution: Number(get('--res') ?? 100),
    verticalExaggeration: Number(get('--exag') ?? 2.2),
  }
}

function sampleAtLonLat(
  lon: number,
  lat: number,
  zoom: number,
  demByKey: Map<string, DemGrid>,
): number {
  // Clamp slightly inside tile edges so floor() picks a loaded neighbor.
  const eps = 1e-10
  const t = lonLatToTile(lon - eps, lat + eps, zoom)
  const key = `${t.z}/${t.x}/${t.y}`
  const dem = demByKey.get(key)
  if (!dem) {
    // Fallback: try exact floor without eps
    const t2 = lonLatToTile(lon, lat, zoom)
    const dem2 = demByKey.get(`${t2.z}/${t2.x}/${t2.y}`)
    if (!dem2) return 0
    return sampleDemTile(lon, lat, t2, dem2)
  }
  return sampleDemTile(lon, lat, t, dem)
}

function sampleDemTile(
  lon: number,
  lat: number,
  t: TileCoord,
  dem: DemGrid,
): number {
  const bbox = tileToBBox(t.z, t.x, t.y)
  const u = (lon - bbox.west) / (bbox.east - bbox.west)
  const v = (bbox.north - lat) / (bbox.north - bbox.south)
  return sampleHeight(
    dem.heights,
    dem.width,
    dem.height,
    Math.min(1, Math.max(0, u)),
    Math.min(1, Math.max(0, v)),
  )
}

function buildContinuousMesh(opts: {
  bbox: BBox
  resolution: number
  originLon: number
  originLat: number
  zoom: number
  demByKey: Map<string, DemGrid>
}): ContinuousTerrainJson {
  const { bbox, resolution, originLon, originLat, zoom, demByKey } = opts
  const resX = resolution
  const resZ = resolution
  const nX = resX + 1
  const nZ = resZ + 1
  const heights: number[] = []
  const colors: string[] = []
  let minElev = Infinity
  let maxElev = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (let row = 0; row < nZ; row++) {
    for (let col = 0; col < nX; col++) {
      const u = col / resX
      const v = row / resZ
      const lon = bbox.west + u * (bbox.east - bbox.west)
      const lat = bbox.north + v * (bbox.south - bbox.north)
      const elev = sampleAtLonLat(lon, lat, zoom, demByKey)
      const local = lonLatToLocalMeters(lon, lat, originLon, originLat)
      heights.push(Math.round(elev * 10) / 10)
      colors.push(rgbToHex(elevationToRgb(elev)))
      minElev = Math.min(minElev, elev)
      maxElev = Math.max(maxElev, elev)
      minX = Math.min(minX, local.x)
      maxX = Math.max(maxX, local.x)
      minZ = Math.min(minZ, local.z)
      maxZ = Math.max(maxZ, local.z)
    }
  }

  return {
    format: 'mapa-osm-terrain-continuous-v1',
    resolutionX: resX,
    resolutionZ: resZ,
    origin: { lon: originLon, lat: originLat },
    bbox,
    boundsLocal: { minX, maxX, minZ, maxZ },
    heights,
    colors,
    minElev,
    maxElev,
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2))
  const bbox = bboxFromCenter(cfg.lon, cfg.lat, cfg.size)
  const tiles = tilesCoveringBBox(bbox, cfg.zoom)

  console.log(`Region: ${cfg.name} (${cfg.id})`)
  console.log(
    `BBox: ${bbox.west.toFixed(4)}, ${bbox.south.toFixed(4)} → ${bbox.east.toFixed(4)}, ${bbox.north.toFixed(4)}`,
  )
  console.log(
    `DEM tiles @ z${cfg.zoom}: ${tiles.length} → continuous mesh ${cfg.meshResolution}²`,
  )

  const rawDir = path.join(DATA, 'raw', cfg.id)
  const outDir = path.join(DATA, 'tiles', cfg.id)
  const publicMirror = path.join(ROOT, 'public', 'tiles', cfg.id)

  const demByKey = new Map<string, DemGrid>()
  const manifestTiles: RegionManifest['tiles'] = []

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    process.stdout.write(
      `\r[${i + 1}/${tiles.length}] DEM ${t.z}/${t.x}/${t.y}…`,
    )
    const dem = await loadOrFetchDem(t, rawDir)
    demByKey.set(`${t.z}/${t.x}/${t.y}`, dem)
    // Keep tile index for future streaming / world scale (raw DEM already cached).
    manifestTiles.push({
      ...t,
      path: `dem-ref/${t.z}/${t.x}/${t.y}`,
    })
  }

  console.log('\nBuilding seamless continuous mesh…')
  const continuous = buildContinuousMesh({
    bbox,
    resolution: cfg.meshResolution,
    originLon: cfg.lon,
    originLat: cfg.lat,
    zoom: cfg.zoom,
    demByKey,
  })

  const continuousRel = 'terrain/continuous.json'
  await writeJson(path.join(outDir, continuousRel), continuous)
  await writeJson(path.join(publicMirror, continuousRel), continuous)

  const manifest: RegionManifest = {
    format: 'mapa-osm-manifest-v1',
    regionId: cfg.id,
    name: cfg.name,
    center: { lon: cfg.lon, lat: cfg.lat },
    bbox,
    zoom: cfg.zoom,
    meshResolution: cfg.meshResolution,
    verticalExaggeration: cfg.verticalExaggeration,
    continuousPath: continuousRel,
    tiles: manifestTiles,
    generatedAt: new Date().toISOString(),
    stats: {
      tileCount: tiles.length,
      minElev: continuous.minElev,
      maxElev: continuous.maxElev,
      grid: `${continuous.resolutionX}×${continuous.resolutionZ}`,
    },
  }

  await writeJson(path.join(outDir, 'manifest.json'), manifest)
  await writeJson(path.join(publicMirror, 'manifest.json'), manifest)

  console.log(
    `Done. Elev ${continuous.minElev.toFixed(0)}–${continuous.maxElev.toFixed(0)} m, seamless ${manifest.stats.grid} → data/tiles/${cfg.id}`,
  )
  console.log('Viewer: npm run dev')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
