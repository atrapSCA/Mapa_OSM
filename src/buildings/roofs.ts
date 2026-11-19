import * as THREE from 'three'
import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { footprintCentroid, ringAreaAbs } from './buildingGeom'

/** Roof shapes inspired by OSMBuildings / Simple 3D Buildings (subset). */
export type RoofShape = 'flat' | 'gabled' | 'pyramidal' | 'skillion'

/** Eaves overhang beyond wall footprint (metres). */
const EAVES_OVERHANG_M = 0.3

function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

type FootprintMetrics = {
  aspect: number
  fill: number
  longM: number
  shortM: number
  verts: number
  area: number
  /** True when OBB pitched roof would look nonsensical (L/U/irregular). */
  complex: boolean
  /** Near-square enough for a pyramidal roof. */
  squarish: boolean
  /** Elongated rectangle — gable along long axis. */
  elongated: boolean
}

function footprintMetrics(ringIn: [number, number][]): FootprintMetrics {
  const pts = openRing(ringIn)
  const obb = footprintOBB(pts, 0)
  const longM = Math.max(obb.halfU, obb.halfV) * 2
  const shortM = Math.min(obb.halfU, obb.halfV) * 2
  const aspect = longM / Math.max(shortM, 0.15)
  const area = ringAreaAbs(ringIn)
  const obbArea = Math.max(longM * shortM, 1e-6)
  const fill = area / obbArea
  const complex = fill < 0.78 || pts.length > 8
  const squarish = aspect <= 1.35 && fill >= 0.85 && pts.length <= 6
  const elongated = aspect >= 1.25 && fill >= 0.78 && pts.length <= 8
  return { aspect, fill, longM, shortM, verts: pts.length, area, complex, squarish, elongated }
}

/**
 * Pick roof from footprint geometry first, kind/hash second.
 * Pyramidal almost never in CZ towns — only church towers; else gabled/flat/skillion.
 */
export function roofShapeForBuilding(b: Building): RoofShape {
  const kind = normalizeKind(b.kind)
  const h = hash01(b.id)
  const ring = b.rings[0]
  if (!ring || ring.length < 3) return 'flat'
  const m = footprintMetrics(ring)

  // Historical towers / churches — only place pyramidal makes sense in CZ
  if (kind === 'church') {
    if (m.squarish) return 'pyramidal'
    return m.elongated ? 'gabled' : 'flat'
  }

  // Irregular / L / U — pitched OBB looks like a tent over empty yard
  if (m.complex) {
    if (kind === 'house' && m.fill >= 0.7 && m.elongated) return 'gabled'
    return 'flat'
  }

  if (kind === 'industrial' || kind === 'garage') {
    if (m.elongated && h < 0.55) return 'gabled'
    if (h < 0.35) return 'skillion'
    return 'flat'
  }

  if (kind === 'farm') {
    if (m.elongated) return 'gabled'
    if (h < 0.4) return 'skillion'
    return 'flat'
  }

  // Houses — gabled (Czech default), never pyramidal
  if (kind === 'house') return 'gabled'

  // Apartments / commercial — large blocks mostly flat
  if (
    kind === 'apartments' ||
    kind === 'commercial' ||
    kind === 'public' ||
    kind === 'building'
  ) {
    if (m.longM > 28 || m.area > 450) return h < 0.2 && m.elongated ? 'gabled' : 'flat'
    if (m.elongated && h < 0.45) return 'gabled'
    return 'flat'
  }

  if (m.elongated) return 'gabled'
  return 'flat'
}

/** Roof rise from short span — keeps pitch natural on long buildings. */
export function roofRiseMeters(b: Building, shape: RoofShape): number {
  if (shape === 'flat') return 0.15
  const ring = b.rings[0] ?? []
  const m = footprintMetrics(ring)
  const short = Math.max(m.shortM, 2)
  if (shape === 'pyramidal') return Math.min(7, Math.max(2.2, short * 0.42))
  if (shape === 'gabled') return Math.min(6.5, Math.max(2.0, short * 0.38))
  return Math.min(5.5, Math.max(1.8, short * 0.32))
}

function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring.slice()
  const last = ring.length - 1
  if (ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]) {
    return ring.slice(0, last)
  }
  return ring.slice()
}

/** Angle of the longest ring edge — primary axis for pitched roofs. */
function longestEdgeAngle(pts: [number, number][]): number {
  let best = 0
  let bestLen = -1
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = dx * dx + dz * dz
    if (len > bestLen) {
      bestLen = len
      best = Math.atan2(dz, dx)
    }
  }
  return best
}

type OBB = {
  ux: number
  uz: number
  vx: number
  vz: number
  halfU: number
  halfV: number
  cx: number
  cz: number
  corners: [number, number][]
}

/**
 * Oriented bounding box aligned to the longest footprint edge.
 * Optional overhang expands the box so eaves sit past the walls.
 */
function footprintOBB(pts: [number, number][], overhang = 0): OBB {
  const angle = longestEdgeAngle(pts)
  const ux = Math.cos(angle)
  const uz = Math.sin(angle)
  const vx = -uz
  const vz = ux

  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const [x, z] of pts) {
    const u = x * ux + z * uz
    const v = x * vx + z * vz
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }

  minU -= overhang
  maxU += overhang
  minV -= overhang
  maxV += overhang

  const midU = (minU + maxU) / 2
  const midV = (minV + maxV) / 2
  const halfU = (maxU - minU) / 2
  const halfV = (maxV - minV) / 2
  const cx = midU * ux + midV * vx
  const cz = midU * uz + midV * vz

  const corner = (du: number, dv: number): [number, number] => [
    cx + du * ux + dv * vx,
    cz + du * uz + dv * vz,
  ]

  return {
    ux,
    uz,
    vx,
    vz,
    halfU,
    halfV,
    cx,
    cz,
    corners: [
      corner(-halfU, -halfV),
      corner(halfU, -halfV),
      corner(halfU, halfV),
      corner(-halfU, halfV),
    ],
  }
}

/** Push a triangle; flip so normal · outward > 0. */
function pushTri(
  positions: number[],
  indices: number[],
  i0: number,
  i1: number,
  i2: number,
  outX = 0,
  outY = 1,
  outZ = 0,
): void {
  const ax = positions[i0 * 3]
  const ay = positions[i0 * 3 + 1]
  const az = positions[i0 * 3 + 2]
  const bx = positions[i1 * 3]
  const by = positions[i1 * 3 + 1]
  const bz = positions[i1 * 3 + 2]
  const cx = positions[i2 * 3]
  const cy = positions[i2 * 3 + 1]
  const cz = positions[i2 * 3 + 2]
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx
  if (nx * outX + ny * outY + nz * outZ < 0) indices.push(i0, i2, i1)
  else indices.push(i0, i1, i2)
}

/** Full gabled roof on oriented bbox — both slopes + gable ends. */
function buildGabledOBB(
  obb: OBB,
  yEaves: number,
  riseExag: number,
  positions: number[],
  indices: number[],
  push: (x: number, y: number, z: number) => number,
): void {
  const { halfU, halfV, cx, cz, ux, uz, vx, vz, corners } = obb
  const [p0, p1, p2, p3] = corners
  const yR = yEaves + riseExag
  const a = push(p0[0], yEaves, p0[1])
  const b = push(p1[0], yEaves, p1[1])
  const c = push(p2[0], yEaves, p2[1])
  const d = push(p3[0], yEaves, p3[1])

  if (halfU >= halfV) {
    const r0 = push(cx - halfU * ux, yR, cz - halfU * uz)
    const r1 = push(cx + halfU * ux, yR, cz + halfU * uz)
    // Both slopes (outward = up)
    pushTri(positions, indices, a, b, r1, 0, 1, 0)
    pushTri(positions, indices, a, r1, r0, 0, 1, 0)
    pushTri(positions, indices, d, r0, r1, 0, 1, 0)
    pushTri(positions, indices, d, r1, c, 0, 1, 0)
    // Gable ends
    pushTri(positions, indices, a, r0, d, -ux, 0, -uz)
    pushTri(positions, indices, b, c, r1, ux, 0, uz)
  } else {
    const r0 = push(cx - halfV * vx, yR, cz - halfV * vz)
    const r1 = push(cx + halfV * vx, yR, cz + halfV * vz)
    pushTri(positions, indices, a, r0, r1, 0, 1, 0)
    pushTri(positions, indices, a, r1, d, 0, 1, 0)
    pushTri(positions, indices, b, c, r1, 0, 1, 0)
    pushTri(positions, indices, b, r1, r0, 0, 1, 0)
    pushTri(positions, indices, a, b, r0, -vx, 0, -vz)
    pushTri(positions, indices, d, r1, c, vx, 0, vz)
  }
}

/** Flat roof following the real footprint (works for L/U via earcut). */
function buildFlatRoof(
  ring: [number, number][],
  yEaves: number,
  positions: number[],
  indices: number[],
  push: (x: number, y: number, z: number) => number,
): void {
  const y = yEaves + 0.04
  const base = ring.map(([x, z]) => push(x, y, z))
  if (ring.length <= 4) {
    for (let i = 1; i < base.length - 1; i++) {
      pushTri(positions, indices, base[0], base[i], base[i + 1], 0, 1, 0)
    }
    return
  }
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z))
  const faces = THREE.ShapeUtils.triangulateShape(contour, [])
  for (const face of faces) {
    const [a, b, c] = face
    pushTri(positions, indices, base[a], base[b], base[c], 0, 1, 0)
  }
}

/**
 * Roof mesh on eaves plane yEaves. Y already includes exaggeration for rise.
 * UV in world metres (X/Z) for roof skins.
 */
export function createRoofGeometry(
  ringIn: [number, number][],
  yEaves: number,
  shape: RoofShape,
  riseExag: number,
): THREE.BufferGeometry | null {
  const ring = openRing(ringIn)
  if (ring.length < 3) return null

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const push = (x: number, y: number, z: number) => {
    const i = positions.length / 3
    positions.push(x, y, z)
    uvs.push(x, z)
    return i
  }

  // Guard: pitched OBB only where footprint allows; pyramidal only if still requested
  const metrics = footprintMetrics(ringIn)
  let resolved: RoofShape = shape
  if (shape === 'pyramidal' && !metrics.squarish) resolved = 'flat'
  if (shape === 'gabled' && metrics.complex && !metrics.elongated) resolved = 'flat'

  if (resolved === 'flat') {
    buildFlatRoof(ring, yEaves, positions, indices, push)
  } else if (resolved === 'pyramidal') {
    const [cx, cz] = footprintCentroid(ringIn)
    const apex = push(cx, yEaves + riseExag, cz)
    // Slight outward offset of eaves for overhang feel on irregular rings
    const base = ring.map(([x, z]) => {
      const dx = x - cx
      const dz = z - cz
      const len = Math.hypot(dx, dz) || 1
      const s = 1 + EAVES_OVERHANG_M / len
      return push(cx + dx * s, yEaves, cz + dz * s)
    })
    for (let i = 0; i < base.length; i++) {
      const i0 = base[i]
      const i1 = base[(i + 1) % base.length]
      const mx = (positions[i0 * 3] + positions[i1 * 3]) / 2 - cx
      const mz = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2]) / 2 - cz
      pushTri(positions, indices, i0, i1, apex, mx, 0.35, mz)
    }
  } else if (resolved === 'gabled') {
    buildGabledOBB(
      footprintOBB(ring, EAVES_OVERHANG_M),
      yEaves,
      riseExag,
      positions,
      indices,
      push,
    )
  } else {
    // skillion — sheds only
    const { halfU, halfV, corners } = footprintOBB(ring, EAVES_OVERHANG_M)
    const [p0, p1, p2, p3] = corners
    const yHi = yEaves + riseExag
    if (halfU >= halfV) {
      const a = push(p0[0], yEaves, p0[1])
      const b = push(p1[0], yEaves, p1[1])
      const c = push(p2[0], yHi, p2[1])
      const d = push(p3[0], yHi, p3[1])
      pushTri(positions, indices, a, b, c, 0, 1, 0)
      pushTri(positions, indices, a, c, d, 0, 1, 0)
    } else {
      const a = push(p0[0], yEaves, p0[1])
      const b = push(p1[0], yHi, p1[1])
      const c = push(p2[0], yHi, p2[1])
      const d = push(p3[0], yEaves, p3[1])
      pushTri(positions, indices, a, b, c, 0, 1, 0)
      pushTri(positions, indices, a, c, d, 0, 1, 0)
    }
  }

  if (indices.length < 3) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.clearGroups()
  geo.addGroup(0, indices.length, 0)
  return geo
}
