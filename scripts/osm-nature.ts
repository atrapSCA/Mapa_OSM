/**
 * OSM natural / landuse / leisure polygons via Overpass.
 * Forests, meadows, farmland, parks, wetlands, …
 */

import { writeFile, mkdir, access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { lonLatToLocalMeters, type BBox } from '../shared/geo.ts'
import type { NatureLayerJson, NaturePolygon } from '../shared/tileFormat.ts'

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const USER_AGENT =
  'MapaOSM/0.0.12 (https://github.com/atrapSCA/Mapa_OSM; local pipeline)'

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

/** Map OSM tags → stable kind used in toggles / colors. */
export function natureKindFromTags(
  tags: Record<string, string>,
): string | null {
  const nat = tags.natural
  const lu = tags.landuse
  const lei = tags.leisure

  if (nat === 'wood' || lu === 'forest') return 'forest'
  if (nat === 'scrub') return 'scrub'
  if (
    nat === 'grassland' ||
    lu === 'grass' ||
    lu === 'meadow' ||
    lu === 'village_green'
  ) {
    return 'grassland'
  }
  if (nat === 'heath') return 'heath'
  if (lu === 'farmland') return 'farmland'
  if (lu === 'orchard') return 'orchard'
  if (lu === 'vineyard') return 'vineyard'
  if (nat === 'wetland') return 'wetland'
  if (lei === 'park' || lei === 'garden' || lei === 'nature_reserve') {
    return 'park'
  }
  if (lu === 'recreation_ground') return 'park'
  if (lu === 'cemetery') return 'cemetery'
  if (lu === 'allotments') return 'allotments'
  if (nat === 'sand' || nat === 'beach') return 'sand'
  if (nat === 'bare_rock' || nat === 'scree' || nat === 'shingle') {
    return 'bare_rock'
  }
  return null
}

function buildQuery(bbox: BBox): string {
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `
[out:json][timeout:300];
(
  way["natural"~"^(wood|scrub|grassland|heath|wetland|sand|beach|bare_rock|scree|shingle)$"](${bb});
  way["landuse"~"^(forest|meadow|grass|farmland|orchard|vineyard|allotments|cemetery|recreation_ground|village_green)$"](${bb});
  way["leisure"~"^(park|garden|nature_reserve)$"](${bb});
  relation["natural"~"^(wood|scrub|grassland|heath|wetland|sand|beach|bare_rock|scree|shingle)$"](${bb});
  relation["landuse"~"^(forest|meadow|grass|farmland|orchard|vineyard|allotments|cemetery|recreation_ground|village_green)$"](${bb});
  relation["leisure"~"^(park|garden|nature_reserve)$"](${bb});
);
out body;
>;
out skel qt;
`.trim()
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
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
    return [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100]
  })
}

function isClosed(coords: { lon: number; lat: number }[]): boolean {
  if (coords.length < 4) return false
  const a = coords[0]
  const b = coords[coords.length - 1]
  return Math.abs(a.lon - b.lon) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9
}

export async function buildNatureLayer(opts: {
  bbox: BBox
  originLon: number
  originLat: number
  rawDir: string
}): Promise<NatureLayerJson> {
  const { bbox, originLon, originLat, rawDir } = opts
  const cachePath = path.join(rawDir, 'osm', 'nature-overpass.json')
  await mkdir(path.dirname(cachePath), { recursive: true })

  let elements: OsmElement[]
  try {
    await access(cachePath)
    const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
      elements: OsmElement[]
    }
    elements = cached.elements
    console.log(`OSM nature: using cache ${cachePath}`)
  } catch {
    console.log('OSM nature: querying Overpass…')
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

  const polygons: NaturePolygon[] = []
  const usedWays = new Set<number>()
  const kindCounts: Record<string, number> = {}

  const pushPoly = (poly: NaturePolygon) => {
    polygons.push(poly)
    kindCounts[poly.kind] = (kindCounts[poly.kind] ?? 0) + 1
  }

  for (const rel of relations) {
    const tags = rel.tags ?? {}
    const kind = natureKindFromTags(tags)
    if (!kind) continue
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
      pushPoly({
        id: `r${rel.id}-${outers.indexOf(outer)}`,
        name: tags.name,
        kind,
        rings: [outer, ...inners],
      })
    }
  }

  for (const way of ways.values()) {
    if (usedWays.has(way.id)) continue
    const tags = way.tags ?? {}
    const kind = natureKindFromTags(tags)
    if (!kind) continue
    const coords = wayCoords(way, nodes)
    if (!isClosed(coords) || coords.length < 4) continue
    const ring = toLocalRing(coords, originLon, originLat)
    if (ring.length < 4) continue
    pushPoly({
      id: `w${way.id}`,
      name: tags.name,
      kind,
      rings: [ring],
    })
  }

  return {
    format: 'mapa-osm-nature-v1',
    origin: { lon: originLon, lat: originLat },
    bbox,
    polygons,
    stats: {
      polygonCount: polygons.length,
      byKind: kindCounts,
    },
  }
}
