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

/** Axis-aligned footprint rectangle (low-poly OBB stand-in). */
function footprintRect(pts: [number, number][]): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cx: number
  cz: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of pts) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
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
    // Rectangular gable on footprint AABB — robust for irregular OSM rings.
    const { minX, maxX, minZ, maxZ, cx, cz } = footprintRect(ring)
    const dx = maxX - minX
    const dz = maxZ - minZ
    const yR = yEaves + riseExag
    if (dx >= dz) {
      // Ridge parallel to X
      const a = push(minX, yEaves, minZ)
      const b = push(maxX, yEaves, minZ)
      const c = push(maxX, yEaves, maxZ)
      const d = push(minX, yEaves, maxZ)
      const r0 = push(minX, yR, cz)
      const r1 = push(maxX, yR, cz)
      indices.push(a, b, r1, a, r1, r0) // south slope
      indices.push(d, r0, r1, d, r1, c) // north slope
      indices.push(a, r0, d) // west gable
      indices.push(b, c, r1) // east gable
    } else {
      // Ridge parallel to Z
      const a = push(minX, yEaves, minZ)
      const b = push(maxX, yEaves, minZ)
      const c = push(maxX, yEaves, maxZ)
      const d = push(minX, yEaves, maxZ)
      const r0 = push(cx, yR, minZ)
      const r1 = push(cx, yR, maxZ)
      indices.push(a, r0, r1, a, r1, d) // west slope
      indices.push(b, c, r1, b, r1, r0) // east slope
      indices.push(a, b, r0) // south gable
      indices.push(d, r1, c) // north gable
    }
  } else {
    // skillion — single slope across AABB short axis
    const { minX, maxX, minZ, maxZ } = footprintRect(ring)
    const dx = maxX - minX
    const dz = maxZ - minZ
    const yHi = yEaves + riseExag
    if (dx >= dz) {
      const a = push(minX, yEaves, minZ)
      const b = push(maxX, yEaves, minZ)
      const c = push(maxX, yHi, maxZ)
      const d = push(minX, yHi, maxZ)
      indices.push(a, b, c, a, c, d)
    } else {
      const a = push(minX, yEaves, minZ)
      const b = push(maxX, yHi, minZ)
      const c = push(maxX, yHi, maxZ)
      const d = push(minX, yEaves, maxZ)
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
