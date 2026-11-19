/**
 * OSM building footprints via Overpass → extruded blocks in the viewer.
 */

import { writeFile, mkdir, access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { lonLatToLocalMeters, type BBox } from '../shared/geo.ts'
import type { Building, BuildingLayerJson } from '../shared/tileFormat.ts'

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const USER_AGENT =
  'MapaOSM/0.0.24 (https://github.com/atrapSCA/Mapa_OSM; local pipeline)'

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

const LEVEL_H = 3.0
const DEFAULT_H = 8

/** Collapse OSM building=* into a few toggle kinds. */
export function buildingKindFromTags(
  tags: Record<string, string>,
): string | null {
  if (!tags.building || tags.building === 'no') return null
  const b = tags.building
  if (
    b === 'house' ||
    b === 'detached' ||
    b === 'semidetached_house' ||
    b === 'terrace' ||
    b === 'bungalow' ||
    b === 'cabin' ||
    b === 'static_caravan'
  ) {
    return 'house'
  }
  if (
    b === 'apartments' ||
    b === 'residential' ||
    b === 'dormitory' ||
    b === 'houseboat'
  ) {
    return 'apartments'
  }
  if (
    b === 'industrial' ||
    b === 'warehouse' ||
    b === 'factory' ||
    b === 'manufacture'
  ) {
    return 'industrial'
  }
  if (
    b === 'commercial' ||
    b === 'retail' ||
    b === 'office' ||
    b === 'supermarket' ||
    b === 'kiosk'
  ) {
    return 'commercial'
  }
  if (
    b === 'church' ||
    b === 'chapel' ||
    b === 'cathedral' ||
    b === 'mosque' ||
    b === 'temple' ||
    b === 'synagogue' ||
    b === 'religious'
  ) {
    return 'church'
  }
  if (
    b === 'school' ||
    b === 'university' ||
    b === 'college' ||
    b === 'kindergarten' ||
    b === 'hospital' ||
    b === 'public' ||
    b === 'civic' ||
    b === 'government'
  ) {
    return 'public'
  }
  if (b === 'garage' || b === 'garages' || b === 'carport' || b === 'shed') {
    return 'garage'
  }
  if (b === 'farm' || b === 'farm_auxiliary' || b === 'barn' || b === 'greenhouse') {
    return 'farm'
  }
  // building=yes and everything else
  return 'building'
}

export function buildingHeightMeters(tags: Record<string, string>): number {
  const h = tags.height
  if (h) {
    const m = parseFloat(h.replace(',', '.').replace(/m$/i, '').trim())
    if (Number.isFinite(m) && m > 1 && m < 200) return m
  }
  const levels = tags['building:levels'] ?? tags.levels
  if (levels) {
    const n = parseFloat(levels.replace(',', '.'))
    if (Number.isFinite(n) && n > 0 && n < 60) {
      return Math.max(DEFAULT_H * 0.5, n * LEVEL_H)
    }
  }
  const kind = buildingKindFromTags(tags)
  if (kind === 'garage' || kind === 'farm') return 4
  if (kind === 'house') return 7
  if (kind === 'apartments') return 14
  if (kind === 'church') return 16
  if (kind === 'industrial') return 10
  if (kind === 'commercial') return 9
  if (kind === 'public') return 11
  return DEFAULT_H
}

function buildQuery(bbox: BBox): string {
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `
[out:json][timeout:120];
(
  way["building"](${bb});
  relation["building"](${bb});
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

function ringAreaAbs(ring: [number, number][]): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return Math.abs(a / 2)
}

function simplifyRing(
  ring: [number, number][],
  maxPts = 32,
): [number, number][] {
  if (ring.length <= maxPts) return ring
  const out: [number, number][] = []
  const last = ring.length - 1
  const closed =
    ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
  const n = closed ? last : ring.length
  const step = (n - 1) / (maxPts - 2)
  out.push(ring[0])
  for (let i = 1; i < maxPts - 1; i++) {
    out.push(ring[Math.round(i * step)])
  }
  if (closed) out.push([ring[0][0], ring[0][1]])
  else out.push(ring[n - 1])
  return out
}

export async function buildBuildingLayer(opts: {
  bbox: BBox
  originLon: number
  originLat: number
  rawDir: string
}): Promise<BuildingLayerJson> {
  const { bbox, originLon, originLat, rawDir } = opts
  const cachePath = path.join(rawDir, 'osm', 'buildings-overpass.json')
  await mkdir(path.dirname(cachePath), { recursive: true })

  let elements: OsmElement[]
  try {
    await access(cachePath)
    const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
      elements: OsmElement[]
    }
    elements = cached.elements
    console.log(`OSM buildings: using cache ${cachePath}`)
  } catch {
    console.log('OSM buildings: querying Overpass…')
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

  const buildings: Building[] = []
  const usedWays = new Set<number>()
  const kindCounts: Record<string, number> = {}

  const MIN_AREA = 20 // m² — drop tiny sheds / junk footprints
  const MAX_BUILDINGS = 7000

  const push = (b: Building) => {
    const area = ringAreaAbs(b.rings[0] ?? [])
    if (area < MIN_AREA) return
    buildings.push(b)
  }

  for (const rel of relations) {
    const tags = rel.tags ?? {}
    const kind = buildingKindFromTags(tags)
    if (!kind) continue
    const height = buildingHeightMeters(tags)
    const outers: [number, number][][] = []
    const inners: [number, number][][] = []
    for (const m of rel.members) {
      if (m.type !== 'way') continue
      const way = ways.get(m.ref)
      if (!way) continue
      usedWays.add(way.id)
      const coords = wayCoords(way, nodes)
      if (coords.length < 3) continue
      const ring = simplifyRing(toLocalRing(coords, originLon, originLat))
      if (m.role === 'inner') inners.push(ring)
      else outers.push(ring)
    }
    outers.forEach((outer, i) => {
      if (outer.length < 4) return
      push({
        id: `r${rel.id}-${i}`,
        name: tags.name,
        kind,
        height,
        rings: [outer, ...inners],
      })
    })
  }

  for (const way of ways.values()) {
    if (usedWays.has(way.id)) continue
    const tags = way.tags ?? {}
    const kind = buildingKindFromTags(tags)
    if (!kind) continue
    const coords = wayCoords(way, nodes)
    if (!isClosed(coords) || coords.length < 4) continue
    const ring = simplifyRing(toLocalRing(coords, originLon, originLat))
    if (ring.length < 4) continue
    push({
      id: `w${way.id}`,
      name: tags.name,
      kind,
      height: buildingHeightMeters(tags),
      rings: [ring],
    })
  }

  // Prefer larger footprints if we exceed the viewer budget.
  buildings.sort(
    (a, b) => ringAreaAbs(b.rings[0] ?? []) - ringAreaAbs(a.rings[0] ?? []),
  )
  const kept = buildings.slice(0, MAX_BUILDINGS)
  for (const b of kept) {
    kindCounts[b.kind] = (kindCounts[b.kind] ?? 0) + 1
  }

  return {
    format: 'mapa-osm-buildings-v1',
    origin: { lon: originLon, lat: originLat },
    bbox,
    buildings: kept,
    stats: {
      buildingCount: kept.length,
      byKind: kindCounts,
    },
  }
}
