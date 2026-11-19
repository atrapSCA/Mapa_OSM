/**
 * Fetch OSM waterways + water polygons via Overpass and convert to local meters.
 * Same bbox workflow later scales via regional extracts / planet.osm.
 */

import { writeFile, mkdir, access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { lonLatToLocalMeters, type BBox } from '../shared/geo.ts'
import type { WaterLayerJson, WaterPolygon, Waterway } from '../shared/tileFormat.ts'

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const USER_AGENT =
  'MapaOSM/0.0.02 (https://github.com/atrapSCA/Mapa_OSM; local pipeline)'

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

type OsmNode = { type: 'node'; id: number; lat: number; lon: number }
type OsmWay = {
  type: 'way'
  id: number
  nodes: number[]
  tags?: Record<string, string>
}
type OsmRelation = {
  type: 'relation'
  id: number
  members: { type: string; ref: number; role: string }[]
  tags?: Record<string, string>
}
type OsmElement = OsmNode | OsmWay | OsmRelation

function waterwayWidth(kind: string): number {
  switch (kind) {
    case 'river':
      return 14
    case 'canal':
      return 10
    case 'stream':
      return 4.5
    case 'drain':
    case 'ditch':
      return 2.5
    default:
      return 5
  }
}

function buildQuery(bbox: BBox): string {
  // Overpass bbox: south,west,north,east
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `
[out:json][timeout:90];
(
  way["natural"="water"](${bb});
  way["landuse"="reservoir"](${bb});
  way["landuse"="basin"](${bb});
  way["water"](${bb});
  relation["natural"="water"](${bb});
  relation["landuse"="reservoir"](${bb});
  way["waterway"~"^(river|stream|canal|drain|ditch)$"](${bb});
);
out body;
>;
out skel qt;
`.trim()
}

async function fetchOverpass(query: string): Promise<{ elements: OsmElement[] }> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of OVERPASS_URLS) {
      try {
        process.stdout.write(`  Overpass ${url.split('/')[2]}… `)
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
        })
        if (res.status === 429 || res.status === 504) {
          console.log(`${res.status}, čekám…`)
          lastErr = new Error(`${url}: ${res.status}`)
          await sleep(2500 * (attempt + 1))
          continue
        }
        if (!res.ok) {
          console.log(`fail ${res.status}`)
          lastErr = new Error(`${url}: ${res.status}`)
          continue
        }
        console.log('OK')
        return (await res.json()) as { elements: OsmElement[] }
      } catch (e) {
        console.log('error')
        lastErr = e
      }
    }
    await sleep(3000)
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Overpass failed: ${String(lastErr)}`)
}

function wayCoords(
  way: OsmWay,
  nodes: Map<number, OsmNode>,
): { lon: number; lat: number }[] {
  const pts: { lon: number; lat: number }[] = []
  for (const id of way.nodes) {
    const n = nodes.get(id)
    if (n) pts.push({ lon: n.lon, lat: n.lat })
  }
  return pts
}

function toLocalRing(
  coords: { lon: number; lat: number }[],
  originLon: number,
  originLat: number,
): [number, number][] {
  return coords.map((c) => {
    const p = lonLatToLocalMeters(c.lon, c.lat, originLon, originLat)
    return [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]
  })
}

function isClosed(coords: { lon: number; lat: number }[]): boolean {
  if (coords.length < 4) return false
  const a = coords[0]
  const b = coords[coords.length - 1]
  return Math.abs(a.lon - b.lon) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9
}

export async function buildWaterLayer(opts: {
  bbox: BBox
  originLon: number
  originLat: number
  rawDir: string
  cacheName?: string
}): Promise<WaterLayerJson> {
  const { bbox, originLon, originLat, rawDir } = opts
  const cachePath = path.join(rawDir, 'osm', opts.cacheName ?? 'water-overpass.json')
  await mkdir(path.dirname(cachePath), { recursive: true })

  let elements: OsmElement[]
  try {
    await access(cachePath)
    const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
      elements: OsmElement[]
    }
    elements = cached.elements
    console.log(`OSM water: using cache ${cachePath}`)
  } catch {
    console.log('OSM water: querying Overpass…')
    const data = await fetchOverpass(buildQuery(bbox))
    elements = data.elements
    await writeFile(cachePath, JSON.stringify(data), 'utf8')
  }

  const nodes = new Map<number, OsmNode>()
  const ways = new Map<number, OsmWay>()
  const relations: OsmRelation[] = []

  for (const el of elements) {
    if (el.type === 'node') {
      const prev = nodes.get(el.id)
      if (!prev || prev.lat == null) nodes.set(el.id, el)
    } else if (el.type === 'way') {
      const prev = ways.get(el.id)
      const elTagged = Boolean(el.tags && Object.keys(el.tags).length)
      const prevTagged = Boolean(prev?.tags && Object.keys(prev.tags).length)
      if (!prev || (elTagged && !prevTagged)) ways.set(el.id, el)
      else if (elTagged) ways.set(el.id, el)
    } else if (el.type === 'relation') {
      relations.push(el)
    }
  }

  const waterways: Waterway[] = []
  const polygons: WaterPolygon[] = []
  const usedWays = new Set<number>()

  for (const rel of relations) {
    const tags = rel.tags ?? {}
    if (
      tags.natural !== 'water' &&
      tags.landuse !== 'reservoir' &&
      tags.landuse !== 'basin'
    ) {
      continue
    }
    const outers: [number, number][][] = []
    const inners: [number, number][][] = []
    for (const m of rel.members) {
      if (m.type !== 'way') continue
      const way = ways.get(m.ref)
      if (!way) continue
      usedWays.add(way.id)
      const coords = wayCoords(way, nodes)
      if (coords.length < 3) continue
      const ring = toLocalRing(coords, originLon, originLat)
      if (m.role === 'inner') inners.push(ring)
      else outers.push(ring)
    }
    for (const outer of outers) {
      if (outer.length < 3) continue
      polygons.push({
        id: `r${rel.id}`,
        name: tags.name,
        kind: tags.landuse === 'reservoir' ? 'reservoir' : 'water',
        rings: [outer, ...inners],
      })
    }
  }

  for (const way of ways.values()) {
    if (usedWays.has(way.id)) continue
    const tags = way.tags ?? {}
    const coords = wayCoords(way, nodes)
    if (coords.length < 2) continue

    const isWaterPoly =
      tags.natural === 'water' ||
      tags.landuse === 'reservoir' ||
      tags.landuse === 'basin' ||
      Boolean(tags.water)

    if (isWaterPoly && isClosed(coords)) {
      const ring = toLocalRing(coords, originLon, originLat)
      if (ring.length >= 4) {
        polygons.push({
          id: `w${way.id}`,
          name: tags.name,
          kind:
            tags.landuse === 'reservoir'
              ? 'reservoir'
              : tags.landuse === 'basin'
                ? 'basin'
                : 'water',
          rings: [ring],
        })
      }
      continue
    }

    const ww = tags.waterway
    if (
      ww === 'river' ||
      ww === 'stream' ||
      ww === 'canal' ||
      ww === 'drain' ||
      ww === 'ditch'
    ) {
      const points = toLocalRing(coords, originLon, originLat)
      if (points.length >= 2) {
        waterways.push({
          id: `w${way.id}`,
          name: tags.name,
          kind: ww,
          width: waterwayWidth(ww),
          points,
        })
      }
    }
  }

  return {
    format: 'mapa-osm-water-v1',
    origin: { lon: originLon, lat: originLat },
    bbox,
    waterways,
    polygons,
    stats: {
      waterwayCount: waterways.length,
      polygonCount: polygons.length,
    },
  }
}
