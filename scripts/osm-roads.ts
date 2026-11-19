/**
 * OSM road network + foot/tourist paths via Overpass.
 * Roads and paths are stored separately for independent viewer toggles.
 */

import { writeFile, mkdir, access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { lonLatToLocalMeters, type BBox } from '../shared/geo.ts'
import type { RoadLayerJson, RoadSegment } from '../shared/tileFormat.ts'

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const USER_AGENT =
  'MapaOSM/0.0.03 (https://github.com/atrapSCA/Mapa_OSM; local pipeline)'

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

const ROAD_KINDS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
  'track',
  'pedestrian', // pěší zóny / náměstí — vizuálně součást silniční sítě
])

const PATH_KINDS = new Set([
  'footway',
  'path',
  'steps',
  'bridleway',
  'cycleway',
  'corridor',
])

function roadWidth(kind: string): number {
  switch (kind) {
    case 'motorway':
    case 'motorway_link':
      return 12
    case 'trunk':
    case 'trunk_link':
      return 10
    case 'primary':
    case 'primary_link':
      return 8
    case 'secondary':
    case 'secondary_link':
      return 7
    case 'tertiary':
    case 'tertiary_link':
      return 6
    case 'residential':
    case 'living_street':
    case 'unclassified':
    case 'road':
    case 'pedestrian':
      return 5
    case 'service':
      return 3.5
    case 'track':
      return 3
    default:
      return 4.5
  }
}

function pathWidth(kind: string): number {
  switch (kind) {
    case 'footway':
      return 1.8
    case 'cycleway':
      return 2.2
    case 'steps':
      return 1.6
    case 'bridleway':
      return 2
    case 'path':
    default:
      return 1.5
  }
}

/** Sidewalk / crossing stay as paths; street-like footways → roads. */
function isSidewalkOrCrossing(tags: Record<string, string>): boolean {
  const fw = tags.footway
  const pw = tags.path
  return (
    fw === 'sidewalk' ||
    fw === 'crossing' ||
    pw === 'sidewalk' ||
    pw === 'crossing' ||
    tags.highway === 'platform' ||
    tags.public_transport === 'platform'
  )
}

/**
 * Promote OSM ways that look like streets but are tagged footway/path
 * (named plazas, shared streets, vehicle-allowed paths).
 */
function shouldBeRoad(tags: Record<string, string>, hw: string): boolean {
  if (hw === 'pedestrian') return true
  if (tags.junction === 'roundabout') return true
  if (
    tags.motor_vehicle === 'yes' ||
    tags.vehicle === 'yes' ||
    tags.motorcar === 'yes'
  ) {
    return true
  }
  // Named street-like footway/path that is NOT a sidewalk → draw as road
  if (
    (hw === 'footway' || hw === 'path') &&
    tags.name &&
    !isSidewalkOrCrossing(tags)
  ) {
    return true
  }
  return false
}

function buildQuery(bbox: BBox): string {
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  // No hiking relations here — their skel members used to overwrite tagged
  // highways and demote real roads (e.g. secondary) into the path layer.
  return `
[out:json][timeout:300];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|track|footway|path|pedestrian|steps|bridleway|cycleway|corridor)$"](${bb});
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

function toLocal(
  coords: { lon: number; lat: number }[],
  originLon: number,
  originLat: number,
): [number, number][] {
  const pts = coords.map((c) => {
    const p = lonLatToLocalMeters(c.lon, c.lat, originLon, originLat)
    return [
      Math.round(p.x * 100) / 100,
      Math.round(p.z * 100) / 100,
    ] as [number, number]
  })
  // Keep OSM closed rings closed after projection (roundabouts).
  if (pts.length >= 3) {
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (
      Math.abs(first.lon - last.lon) < 1e-9 &&
      Math.abs(first.lat - last.lat) < 1e-9
    ) {
      pts[pts.length - 1] = [pts[0][0], pts[0][1]]
    }
  }
  return densifyClosed(pts, 10)
}

/** Extra vertices on long segments of closed rings → smoother roundabouts. */
function densifyClosed(
  points: [number, number][],
  maxSegMeters: number,
): [number, number][] {
  if (points.length < 4) return points
  const closed =
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
  if (!closed) return points

  const out: [number, number][] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    out.push(a)
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    const steps = Math.floor(d / maxSegMeters)
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1)
      out.push([
        Math.round((a[0] + (b[0] - a[0]) * t) * 100) / 100,
        Math.round((a[1] + (b[1] - a[1]) * t) * 100) / 100,
      ])
    }
  }
  out.push([points[0][0], points[0][1]])
  return out
}

function segmentWidth(tags: Record<string, string>, base: number): number {
  if (tags.junction === 'roundabout') return Math.max(base * 1.4, base + 2)
  return base
}

function endpointKey(p: [number, number], digits = 1): string {
  return `${p[0].toFixed(digits)},${p[1].toFixed(digits)}`
}

/**
 * OSM often splits a roundabout into several open arcs.
 * Stitch arcs that share endpoints into continuous (ideally closed) rings.
 */
function stitchRoundabouts(segments: RoadSegment[]): RoadSegment[] {
  const arcs = segments.filter((s) => s.kind === 'roundabout')
  const rest = segments.filter((s) => s.kind !== 'roundabout')
  if (arcs.length === 0) return segments

  const used = new Set<number>()
  const merged: RoadSegment[] = []

  for (let i = 0; i < arcs.length; i++) {
    if (used.has(i)) continue
    used.add(i)
    let pts = arcs[i].points.slice()
    let width = arcs[i].width
    let name = arcs[i].name
    let grew = true
    while (grew) {
      grew = false
      const head = endpointKey(pts[0])
      const tail = endpointKey(pts[pts.length - 1])
      for (let j = 0; j < arcs.length; j++) {
        if (used.has(j)) continue
        const other = arcs[j].points
        const oHead = endpointKey(other[0])
        const oTail = endpointKey(other[other.length - 1])
        if (tail === oHead) {
          pts = pts.concat(other.slice(1))
          used.add(j)
          width = Math.max(width, arcs[j].width)
          name = name ?? arcs[j].name
          grew = true
          break
        }
        if (tail === oTail) {
          pts = pts.concat(other.slice(0, -1).reverse())
          used.add(j)
          width = Math.max(width, arcs[j].width)
          name = name ?? arcs[j].name
          grew = true
          break
        }
        if (head === oTail) {
          pts = other.slice(0, -1).concat(pts)
          used.add(j)
          width = Math.max(width, arcs[j].width)
          name = name ?? arcs[j].name
          grew = true
          break
        }
        if (head === oHead) {
          pts = other.slice(1).reverse().concat(pts)
          used.add(j)
          width = Math.max(width, arcs[j].width)
          name = name ?? arcs[j].name
          grew = true
          break
        }
      }
    }

    // Close ring if endpoints are near (OSM arcs often leave a small gap).
    if (pts.length >= 3) {
      const a = pts[0]
      const b = pts[pts.length - 1]
      const gap = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (gap <= 0.05) {
        pts[pts.length - 1] = [a[0], a[1]]
      } else if (gap < 30) {
        pts = pts.concat([[a[0], a[1]]])
      }
    }

    const closed =
      pts.length >= 4 &&
      pts[0][0] === pts[pts.length - 1][0] &&
      pts[0][1] === pts[pts.length - 1][1]

    merged.push({
      id: `rb-${arcs[i].id}`,
      name,
      kind: 'roundabout',
      group: 'road',
      width,
      points: closed ? densifyClosed(pts, 8) : pts,
    })
  }

  return [...rest, ...merged]
}

export async function buildRoadLayer(opts: {
  bbox: BBox
  originLon: number
  originLat: number
  rawDir: string
}): Promise<RoadLayerJson> {
  const { bbox, originLon, originLat, rawDir } = opts
  const cachePath = path.join(rawDir, 'osm', 'roads-overpass.json')
  await mkdir(path.dirname(cachePath), { recursive: true })

  let elements: OsmElement[]
  try {
    await access(cachePath)
    const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
      elements: OsmElement[]
    }
    elements = cached.elements
    console.log(`OSM roads: using cache ${cachePath}`)
  } catch {
    console.log('OSM roads: querying Overpass…')
    const data = await fetchOverpass(buildQuery(bbox))
    elements = data.elements
    await writeFile(cachePath, JSON.stringify(data), 'utf8')
  }

  const nodes = new Map<number, OsmNode>()
  const ways = new Map<number, OsmWay>()

  /**
   * Overpass `out skel` duplicates ways/nodes WITHOUT tags.
   * Never let a skel stub overwrite a fully tagged element — that used to
   * strip highway=secondary/residential and dump KČT route members into paths.
   */
  for (const el of elements) {
    if (el.type === 'node') {
      const prev = nodes.get(el.id)
      if (!prev || prev.lat == null) nodes.set(el.id, el)
    } else if (el.type === 'way') {
      const prev = ways.get(el.id)
      const elTagged = Boolean(el.tags && Object.keys(el.tags).length)
      const prevTagged = Boolean(prev?.tags && Object.keys(prev.tags).length)
      if (!prev || (elTagged && !prevTagged)) ways.set(el.id, el)
      else if (elTagged && prevTagged) ways.set(el.id, el)
      else if (!prev) ways.set(el.id, el)
    }
  }

  const roads: RoadSegment[] = []
  const paths: RoadSegment[] = []

  for (const way of ways.values()) {
    const tags = way.tags ?? {}
    const hw = tags.highway
    if (!hw) continue // skel stub or untagged — skip

    const coords = wayCoords(way, nodes)
    if (coords.length < 2) continue
    const points = toLocal(coords, originLon, originLat)
    if (points.length < 2) continue

    // Street-like geometries tagged as footway/path/pedestrian → roads
    if (
      (PATH_KINDS.has(hw) || hw === 'pedestrian') &&
      shouldBeRoad(tags, hw)
    ) {
      const kind =
        tags.junction === 'roundabout' ? 'roundabout' : 'pedestrian'
      roads.push({
        id: `w${way.id}`,
        name: tags.name ?? tags.ref,
        kind,
        group: 'road',
        width: segmentWidth(tags, roadWidth('pedestrian')),
        points,
      })
      continue
    }

    // True foot/cycle paths only (sidewalks, trails, steps…)
    if (PATH_KINDS.has(hw)) {
      paths.push({
        id: `w${way.id}`,
        name: tags.name,
        kind: isSidewalkOrCrossing(tags) ? 'footway' : hw,
        group: 'path',
        width: segmentWidth(tags, pathWidth(hw)),
        points,
      })
      continue
    }

    // All drivAble / cartographic road classes — including track & pedestrian
    // Membership in a hiking route must NOT demote a road to a path.
    if (ROAD_KINDS.has(hw)) {
      const kind =
        tags.junction === 'roundabout' ? 'roundabout' : hw
      roads.push({
        id: `w${way.id}`,
        name: tags.name ?? tags.ref,
        kind,
        group: 'road',
        width: segmentWidth(tags, roadWidth(hw)),
        points,
      })
    }
  }

  const stitchedRoads = stitchRoundabouts(roads)

  return {
    format: 'mapa-osm-roads-v1',
    origin: { lon: originLon, lat: originLat },
    bbox,
    roads: stitchedRoads,
    paths,
    stats: {
      roadCount: stitchedRoads.length,
      pathCount: paths.length,
    },
  }
}
