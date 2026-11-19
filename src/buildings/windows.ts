import * as THREE from 'three'
import type { Building, RoadSegment } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import type { RoofShape } from './roofs'

function hash01(id: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring.slice()
  const last = ring.length - 1
  if (ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]) {
    return ring.slice(0, last)
  }
  return ring.slice()
}

/**
 * Window storey rows from CZ height→floors table (flat vs pitched).
 * Pitched includes attic as a row where the table lists podkroví.
 */
export function storeysForWindows(
  heightM: number,
  roofShape: RoofShape,
): number {
  const h = Math.max(2.5, Math.min(80, heightM))
  const pitched = roofShape === 'gabled' || roofShape === 'pyramidal'

  if (h < 4.5) return 1
  if (h < 6.5) return pitched ? 2 : 2
  if (h < 9.5) return 3
  if (h < 12.5) return 4
  if (h < 16) return 5
  if (h < 22) return 6
  if (h < 28) return 8
  if (h < 35) return 10
  if (h < 45) return 12
  return Math.min(18, Math.round(h / 3.2))
}

export type StreetEdge = {
  edgeIndex: number
  a: [number, number]
  b: [number, number]
  len: number
  mid: [number, number]
}

/** Edge midpoint closest to any sampled road point; else longest edge. */
export function streetFacingEdge(
  ring: [number, number][],
  roads: RoadSegment[] | null | undefined,
): StreetEdge | null {
  const pts = openRing(ring)
  if (pts.length < 3) return null

  let bestLong: StreetEdge | null = null
  let bestLongLen = -1
  const edges: StreetEdge[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const e: StreetEdge = { edgeIndex: i, a, b, len, mid }
    edges.push(e)
    if (len > bestLongLen) {
      bestLongLen = len
      bestLong = e
    }
  }

  if (!roads || roads.length === 0) return bestLong

  let bestDist = Infinity
  let bestEdge: StreetEdge | null = null
  for (const e of edges) {
    if (e.len < 2.5) continue
    for (const seg of roads) {
      const sp = seg.points
      if (!sp || sp.length < 2) continue
      for (let i = 0; i < sp.length - 1; i++) {
        const p0 = sp[i]
        const p1 = sp[i + 1]
        const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        const steps = Math.max(1, Math.ceil(segLen / 7))
        for (let s = 0; s <= steps; s++) {
          const t = s / steps
          const x = p0[0] + (p1[0] - p0[0]) * t
          const z = p0[1] + (p1[1] - p0[1]) * t
          const d = Math.hypot(e.mid[0] - x, e.mid[1] - z)
          if (d < bestDist) {
            bestDist = d
            bestEdge = e
          }
        }
      }
    }
  }

  if (!bestEdge || bestDist > 25) return bestLong
  return bestEdge
}

export function shouldHaveGarageDoor(b: Building): boolean {
  const kind = normalizeKind(b.kind)
  const h = Math.max(2.5, Math.min(80, b.height))
  if (h > 7) return false
  const roll = hash01(b.id, 77)
  if (kind === 'garage') return roll < 0.85
  if (kind === 'house') return roll < 0.4
  if (kind === 'farm' || kind === 'building') return h <= 5.5 && roll < 0.22
  return false
}

export type GarageDoorInfo = {
  edgeIndex: number
  /** Parametric t0..t1 along edge for window skip zone. */
  t0: number
  t1: number
}

/**
 * Lit window quads on façade walls.
 * yBase = building foot; wallHExag = full wall height already exaggerated.
 */
export function createWindowGeometry(
  b: Building,
  yBase: number,
  wallHExag: number,
  roofShape: RoofShape,
  roads?: RoadSegment[] | null,
): THREE.BufferGeometry | null {
  const kind = normalizeKind(b.kind)
  if (kind === 'garage') return null
  if (kind === 'church') return null

  const ring = openRing(b.rings[0] ?? [])
  if (ring.length < 3) return null

  const positions: number[] = []
  const indices: number[] = []

  const winW = kind === 'apartments' ? 1.4 : 1.15
  const winH = kind === 'apartments' ? 1.5 : 1.25
  const rows = storeysForWindows(b.height, roofShape)
  const litChance = kind === 'industrial' ? 0.25 : 0.55

  const pitched = roofShape === 'gabled' || roofShape === 'pyramidal'
  const topMargin = wallHExag * (pitched ? 0.18 : 0.08)
  const usableH = Math.max(wallHExag - topMargin, winH * 1.2)
  const rowPitch = usableH / rows
  const sill0 = Math.min(1.0 * (wallHExag / Math.max(b.height, 2.5)), rowPitch * 0.25)
  const winHEx = Math.min(winH * (wallHExag / Math.max(b.height, 2.5)), rowPitch * 0.55)
  const outset = 0.06

  // Garage door skip zone on street edge (ground floor only)
  let doorSkip: GarageDoorInfo | null = null
  if (shouldHaveGarageDoor(b)) {
    const edge = streetFacingEdge(ring, roads)
    if (edge && edge.len >= 3.2) {
      const doorW = Math.min(2.5, edge.len * 0.45)
      const midT = 0.35 + hash01(b.id, 78) * 0.3
      const half = doorW / (2 * edge.len)
      doorSkip = {
        edgeIndex: edge.edgeIndex,
        t0: Math.max(0.05, midT - half),
        t1: Math.min(0.95, midT + half),
      }
    }
  }

  let salt = 1
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e]
    const c = ring[(e + 1) % ring.length]
    const dx = c[0] - a[0]
    const dz = c[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < winW * 1.8) continue

    let nx = -dz / len
    let nz = dx / len
    let cx = 0
    let cz = 0
    for (const p of ring) {
      cx += p[0]
      cz += p[1]
    }
    cx /= ring.length
    cz /= ring.length
    const mx = (a[0] + c[0]) / 2
    const mz = (a[1] + c[1]) / 2
    if ((mx - cx) * nx + (mz - cz) * nz < 0) {
      nx = -nx
      nz = -nz
    }

    const margin = winW * 0.7
    const usable = len - 2 * margin
    if (usable < winW) continue
    const count = Math.max(1, Math.floor(usable / (winW * 1.55)))

    for (let i = 0; i < count; i++) {
      for (let f = 0; f < rows; f++) {
        salt++
        if (hash01(b.id, salt) > litChance) continue

        const tCenter = margin / len + ((i + 0.5) / count) * (usable / len)
        const halfTw = winW / (2 * len)
        const t0 = tCenter - halfTw
        const t1 = tCenter + halfTw
        if (t0 < 0 || t1 > 1) continue

        // Skip ground-floor windows overlapping garage door
        if (
          f === 0 &&
          doorSkip &&
          doorSkip.edgeIndex === e &&
          tCenter > doorSkip.t0 &&
          tCenter < doorSkip.t1
        ) {
          continue
        }

        const y0 = yBase + sill0 + f * rowPitch
        const y1 = y0 + winHEx
        if (y1 > yBase + wallHExag - topMargin * 0.35) continue

        const x0 = a[0] + dx * t0 + nx * outset
        const z0 = a[1] + dz * t0 + nz * outset
        const x1 = a[0] + dx * t1 + nx * outset
        const z1 = a[1] + dz * t1 + nz * outset

        const base = positions.length / 3
        positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0)
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
  }

  if (indices.length < 3) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** Dark garage door quad on street-facing façade. */
export function createGarageDoorGeometry(
  b: Building,
  yBase: number,
  wallHExag: number,
  roads?: RoadSegment[] | null,
): THREE.BufferGeometry | null {
  if (!shouldHaveGarageDoor(b)) return null
  const ring = openRing(b.rings[0] ?? [])
  if (ring.length < 3) return null

  const edge = streetFacingEdge(ring, roads)
  if (!edge || edge.len < 3.2) return null

  const doorW = Math.min(2.5, Math.max(2.15, edge.len * 0.42))
  const doorH = Math.min(2.15, wallHExag * 0.55)
  const midT = 0.35 + hash01(b.id, 78) * 0.3
  const half = doorW / (2 * edge.len)
  const t0 = Math.max(0.04, midT - half)
  const t1 = Math.min(0.96, midT + half)

  const dx = edge.b[0] - edge.a[0]
  const dz = edge.b[1] - edge.a[1]
  const len = edge.len
  let nx = -dz / len
  let nz = dx / len
  let cx = 0
  let cz = 0
  for (const p of ring) {
    cx += p[0]
    cz += p[1]
  }
  cx /= ring.length
  cz /= ring.length
  if ((edge.mid[0] - cx) * nx + (edge.mid[1] - cz) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  const outset = 0.08
  const y0 = yBase + 0.05
  const y1 = y0 + doorH

  const x0 = edge.a[0] + dx * t0 + nx * outset
  const z0 = edge.a[1] + dz * t0 + nz * outset
  const x1 = edge.a[0] + dx * t1 + nx * outset
  const z1 = edge.a[1] + dz * t1 + nz * outset

  const positions = [x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0]
  const indices = [0, 1, 2, 0, 2, 3]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

const windowMat = new THREE.MeshStandardMaterial({
  color: '#ffe6a0',
  emissive: '#ffcc66',
  emissiveIntensity: 1.35,
  roughness: 0.4,
  metalness: 0,
  flatShading: true,
  toneMapped: false,
})

const garageDoorMat = new THREE.MeshStandardMaterial({
  color: '#2e2e34',
  flatShading: true,
  roughness: 0.75,
  metalness: 0.12,
})

export function getWindowMaterial(): THREE.MeshStandardMaterial {
  return windowMat
}

export function getGarageDoorMaterial(): THREE.MeshStandardMaterial {
  return garageDoorMat
}
