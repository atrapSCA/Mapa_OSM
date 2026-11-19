import * as THREE from 'three'
import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { footprintCentroid, ringAreaAbs } from './buildingGeom'

/** Roof shapes inspired by OSMBuildings / Simple 3D Buildings (subset). */
export type RoofShape = 'flat' | 'gabled' | 'pyramidal' | 'skillion'

function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/**
 * Pick roof style from kind + id (OSM rarely tags roof:shape in CZ).
 * Biased toward pitched roofs so the scene is not all flat boxes.
 */
export function roofShapeForBuilding(b: Building): RoofShape {
  const kind = normalizeKind(b.kind)
  const h = hash01(b.id)

  if (kind === 'church') return 'pyramidal'

  // Halls / sheds — often flat or single-slope
  if (kind === 'industrial' || kind === 'garage') {
    if (h < 0.45) return 'skillion'
    if (h < 0.7) return 'gabled'
    return 'flat'
  }

  // Farm — almost never flat
  if (kind === 'farm') {
    return h < 0.55 ? 'gabled' : 'skillion'
  }

  // Houses — always pitched
  if (kind === 'house') {
    if (h < 0.5) return 'gabled'
    if (h < 0.78) return 'pyramidal'
    return 'skillion'
  }

  // Apartments / commercial / public — mostly pitched for variety
  // (real cities mix flat panels + older gables)
  if (
    kind === 'apartments' ||
    kind === 'commercial' ||
    kind === 'public' ||
    kind === 'building'
  ) {
    if (h < 0.42) return 'gabled'
    if (h < 0.68) return 'pyramidal'
    if (h < 0.85) return 'skillion'
    return 'flat'
  }

  // Fallback
  if (h < 0.4) return 'gabled'
  if (h < 0.7) return 'pyramidal'
  if (h < 0.9) return 'skillion'
  return 'flat'
}

/** Roof rise in metres before vertical exaggeration — kept bold so slopes read from above. */
export function roofRiseMeters(b: Building, shape: RoofShape): number {
  if (shape === 'flat') return 0.15
  const area = ringAreaAbs(b.rings[0] ?? [])
  const span = Math.sqrt(Math.max(area, 1))
  // Stronger pitch than S3DB defaults so gables/pyramids are obvious in the viewer
  if (shape === 'pyramidal') return Math.min(14, Math.max(3.5, span * 0.35))
  if (shape === 'gabled') return Math.min(11, Math.max(3.0, span * 0.28))
  return Math.min(9, Math.max(2.5, span * 0.22))
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

/**
 * Oriented bounding box of the footprint (aligned to longest edge).
 * World AABB made roofs look rotated ~30–45° on street-angled buildings.
 */
function footprintOBB(pts: [number, number][]): {
  /** Unit along longest edge (ridge candidate). */
  ux: number
  uz: number
  /** Unit perpendicular in XZ. */
  vx: number
  vz: number
  halfU: number
  halfV: number
  cx: number
  cz: number
  /** Four eaves corners in CCW order: -u-v, +u-v, +u+v, -u+v. */
  corners: [number, number][]
} {
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

  if (shape === 'flat') {
    const base = ring.map(([x, z]) => push(x, yEaves + 0.04, z))
    for (let i = 1; i < base.length - 1; i++) {
      indices.push(base[0], base[i], base[i + 1])
    }
  } else if (shape === 'pyramidal') {
    const [cx, cz] = footprintCentroid(ringIn)
    const apex = push(cx, yEaves + riseExag, cz)
    const base = ring.map(([x, z]) => push(x, yEaves, z))
    for (let i = 0; i < base.length; i++) {
      indices.push(base[i], base[(i + 1) % base.length], apex)
    }
  } else if (shape === 'gabled') {
    // Gable on OBB aligned to longest footprint edge (not world AABB).
    const { halfU, halfV, cx, cz, ux, uz, vx, vz, corners } = footprintOBB(ring)
    const [p0, p1, p2, p3] = corners
    const yR = yEaves + riseExag
    const a = push(p0[0], yEaves, p0[1])
    const b = push(p1[0], yEaves, p1[1])
    const c = push(p2[0], yEaves, p2[1])
    const d = push(p3[0], yEaves, p3[1])
    if (halfU >= halfV) {
      // Ridge along long axis u, midpoint of short sides (±v)
      const r0 = push(cx - halfU * ux, yR, cz - halfU * uz)
      const r1 = push(cx + halfU * ux, yR, cz + halfU * uz)
      indices.push(a, b, r1, a, r1, r0) // -v slope
      indices.push(d, r0, r1, d, r1, c) // +v slope
      indices.push(a, r0, d) // -u gable
      indices.push(b, c, r1) // +u gable
    } else {
      // Ridge along v (footprint taller than long-edge span)
      const r0 = push(cx - halfV * vx, yR, cz - halfV * vz)
      const r1 = push(cx + halfV * vx, yR, cz + halfV * vz)
      indices.push(a, r0, r1, a, r1, d) // -u slope
      indices.push(b, c, r1, b, r1, r0) // +u slope
      indices.push(a, b, r0) // -v gable
      indices.push(d, r1, c) // +v gable
    }
  } else {
    // skillion — single slope across short OBB axis
    const { halfU, halfV, corners } = footprintOBB(ring)
    const [p0, p1, p2, p3] = corners
    const yHi = yEaves + riseExag
    if (halfU >= halfV) {
      const a = push(p0[0], yEaves, p0[1])
      const b = push(p1[0], yEaves, p1[1])
      const c = push(p2[0], yHi, p2[1])
      const d = push(p3[0], yHi, p3[1])
      indices.push(a, b, c, a, c, d)
    } else {
      const a = push(p0[0], yEaves, p0[1])
      const b = push(p1[0], yHi, p1[1])
      const c = push(p2[0], yHi, p2[1])
      const d = push(p3[0], yEaves, p3[1])
      indices.push(a, b, c, a, c, d)
    }
  }

  if (indices.length < 3) return null

  // Flip any triangle whose geometric normal points inward / downward
  // (fixes front faces culled while back faces show through).
  fixRoofWinding(positions, indices)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.clearGroups()
  geo.addGroup(0, indices.length, 0)
  return geo
}

/** Ensure each triangle faces outward (away from roof centroid, preferably up). */
function fixRoofWinding(positions: number[], indices: number[]): void {
  let cx = 0
  let cy = 0
  let cz = 0
  const nVert = positions.length / 3
  for (let i = 0; i < nVert; i++) {
    cx += positions[i * 3]
    cy += positions[i * 3 + 1]
    cz += positions[i * 3 + 2]
  }
  cx /= nVert
  cy /= nVert
  cz /= nVert

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const outward = new THREE.Vector3()

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]
    const i1 = indices[t + 1]
    const i2 = indices[t + 2]
    a.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2])
    b.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2])
    c.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2])
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    normal.crossVectors(ab, ac).normalize()

    // Prefer upward; for vertical gables fall back to away-from-centroid
    const faceCx = (a.x + b.x + c.x) / 3
    const faceCy = (a.y + b.y + c.y) / 3
    const faceCz = (a.z + b.z + c.z) / 3
    outward.set(faceCx - cx, faceCy - cy, faceCz - cz)
    if (outward.lengthSq() < 1e-8) outward.set(0, 1, 0)
    else outward.normalize()

    // Roof faces should not point into the building volume
    if (normal.dot(outward) < 0 || (Math.abs(normal.y) > 0.3 && normal.y < 0)) {
      indices[t + 1] = i2
      indices[t + 2] = i1
    }
  }
}
