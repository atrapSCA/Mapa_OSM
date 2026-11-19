import * as THREE from 'three'
import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { footprintCentroid, ringAreaAbs } from './buildingGeom'
import {
  appendFlatRoofDetails,
  flatRoofVariantForBuilding,
} from './flatRoofVariants'

/** Roof shapes inspired by OSMBuildings / Simple 3D Buildings (subset). */
export type RoofShape = 'flat' | 'gabled' | 'pyramidal' | 'skillion'

/** Eaves overhang beyond wall footprint (metres). */
const EAVES_OVERHANG_M = 0.3

/** Typical CZ clay tile hues — reds and browns (pitched roofs). */
export const CZ_ROOF_COLORS = [
  '#a83a2c', // classic brick red
  '#8f2f24', // deep red
  '#b54a32', // terracotta
  '#9c4030', // brick
  '#7a3224', // dark red-brown
  '#8b4a2b', // brown tile
  '#6e3a28', // dark brown
  '#a0522d', // sienna
  '#c45c3e', // lighter terracotta
  '#5c3320', // chocolate
  '#914d36', // rust brown
  '#7d3b2f', // muted red-brown
] as const

/** Flat / membrane roofs — mid greys & olive (no near-black — looks unnatural). */
export const CZ_FLAT_ROOF_COLORS = [
  '#7a7a7a',
  '#6a6a6a',
  '#5c5c5c',
  '#555555',
  '#666666',
  '#5a5a5a',
  '#707070',
  '#626262',
  '#686868',
  '#5a5c52', // olive grey
  '#4e524c',
  '#6b6e62',
  '#585c56',
  '#737873',
] as const

/** Occasional timber gable boarding. */
export const GABLE_WOOD_COLOR = '#6b4423'

/** Brick chimney stacks on classic pitched roofs. */
export const CHIMNEY_COLOR = '#5c4030'

function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** Roof deck colour: grey/black for flat, red/brown for pitched. */
export function roofColorForBuilding(b: Building, shape?: RoofShape): string {
  const s = shape ?? roofShapeForBuilding(b)
  const palette = s === 'flat' ? CZ_FLAT_ROOF_COLORS : CZ_ROOF_COLORS
  const i = Math.floor(hash01(b.id) * palette.length) % palette.length
  return palette[i]
}

/** Gable face: mostly wall colour, ~22% wood boarding. */
export function gableIsWood(b: Building): boolean {
  return hash01(b.id + ':gable') < 0.22
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
 * CZ vernacular: large / tall → flat; small / low → classic gable.
 * Pyramidal only on church towers.
 */
export function roofShapeForBuilding(b: Building): RoofShape {
  const kind = normalizeKind(b.kind)
  const h = hash01(b.id)
  const ring = b.rings[0]
  if (!ring || ring.length < 3) return 'flat'
  const m = footprintMetrics(ring)
  const height = Math.max(2.5, Math.min(80, b.height))
  // Small & low family-scale building (typical pitched roof in CZ)
  const smallLow = m.area <= 200 && m.longM <= 22 && height <= 11
  // Large footprint or panelák / hall scale → flat roof
  const large = m.area >= 280 || m.longM >= 26 || height >= 13

  // Historical towers / churches
  if (kind === 'church') {
    if (m.squarish) return 'pyramidal'
    return m.elongated ? 'gabled' : 'flat'
  }

  // L / U / irregular — OBB gable looks wrong; keep flat
  // (except compact houses that are still mostly rectangular)
  if (m.complex) {
    if (kind === 'house' && smallLow && m.fill >= 0.72) return 'gabled'
    return 'flat'
  }

  // Size rules dominate kind (matches Czech towns)
  if (large) {
    if (kind === 'farm' && m.elongated && h < 0.25) return 'gabled'
    return 'flat'
  }

  if (smallLow || kind === 'house') {
    if (kind === 'garage' && h < 0.4) return 'skillion'
    return 'gabled'
  }

  // Mid-size
  if (kind === 'industrial' || kind === 'garage') {
    if (h < 0.4) return 'skillion'
    return 'flat'
  }
  if (kind === 'farm') return m.elongated ? 'gabled' : 'flat'
  if (kind === 'apartments') return 'flat'
  // Smaller commercial / public / generic — often still pitched in older fabric
  if (m.elongated || h < 0.55) return 'gabled'
  return 'flat'
}

/**
 * Roof rise in unexaggerated metres.
 * Uses a fixed on-screen pitch so every gable looks equally steep; divides by
 * vertical exaggeration because only Y is scaled (otherwise roofs look like tents).
 */
export function roofRiseMeters(
  b: Building,
  shape: RoofShape,
  verticalExaggeration = 2.2,
): number {
  if (shape === 'flat') return 0.12
  const m = footprintMetrics(b.rings[0] ?? [])
  const halfWidth = Math.max(m.shortM, 2.5) / 2
  // Same visual pitch for all roofs of a given type (~28–32°)
  const pitchDeg = shape === 'pyramidal' ? 32 : shape === 'gabled' ? 28 : 24
  const exag = Math.max(verticalExaggeration, 1)
  const riseForPitch =
    (Math.tan((pitchDeg * Math.PI) / 180) * halfWidth) / exag
  const wallH = Math.max(2.5, Math.min(80, b.height))
  // Never taller than ~28% of the wall; keep a modest absolute band
  return Math.max(0.7, Math.min(riseForPitch, wallH * 0.28, 2.8))
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

/**
 * Full gabled roof on oriented bbox.
 * Slope triangles first (mat 0), then gable ends (mat 1).
 * Returns index counts for multi-material groups.
 */
function buildGabledOBB(
  obb: OBB,
  yEaves: number,
  riseExag: number,
  positions: number[],
  indices: number[],
  push: (x: number, y: number, z: number) => number,
): { slopeCount: number; gableCount: number } {
  const { halfU, halfV, cx, cz, ux, uz, vx, vz, corners } = obb
  const [p0, p1, p2, p3] = corners
  const yR = yEaves + riseExag
  const a = push(p0[0], yEaves, p0[1])
  const b = push(p1[0], yEaves, p1[1])
  const c = push(p2[0], yEaves, p2[1])
  const d = push(p3[0], yEaves, p3[1])
  const before = indices.length

  if (halfU >= halfV) {
    const r0 = push(cx - halfU * ux, yR, cz - halfU * uz)
    const r1 = push(cx + halfU * ux, yR, cz + halfU * uz)
    pushTri(positions, indices, a, b, r1, 0, 1, 0)
    pushTri(positions, indices, a, r1, r0, 0, 1, 0)
    pushTri(positions, indices, d, r0, r1, 0, 1, 0)
    pushTri(positions, indices, d, r1, c, 0, 1, 0)
    const afterSlopes = indices.length
    pushTri(positions, indices, a, r0, d, -ux, 0, -uz)
    pushTri(positions, indices, b, c, r1, ux, 0, uz)
    return {
      slopeCount: afterSlopes - before,
      gableCount: indices.length - afterSlopes,
    }
  }

  const r0 = push(cx - halfV * vx, yR, cz - halfV * vz)
  const r1 = push(cx + halfV * vx, yR, cz + halfV * vz)
  pushTri(positions, indices, a, r0, r1, 0, 1, 0)
  pushTri(positions, indices, a, r1, d, 0, 1, 0)
  pushTri(positions, indices, b, c, r1, 0, 1, 0)
  pushTri(positions, indices, b, r1, r0, 0, 1, 0)
  const afterSlopes = indices.length
  pushTri(positions, indices, a, b, r0, -vx, 0, -vz)
  pushTri(positions, indices, d, r1, c, vx, 0, vz)
  return {
    slopeCount: afterSlopes - before,
    gableCount: indices.length - afterSlopes,
  }
}

/** Simple brick box (no bottom) for chimney stacks. */
function addChimneyBox(
  positions: number[],
  indices: number[],
  push: (x: number, y: number, z: number) => number,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  halfU: number,
  halfV: number,
  ux: number,
  uz: number,
  vx: number,
  vz: number,
): void {
  const c = (du: number, dv: number, y: number) =>
    push(cx + du * ux + dv * vx, y, cz + du * uz + dv * vz)
  const b000 = c(-halfU, -halfV, y0)
  const b100 = c(halfU, -halfV, y0)
  const b110 = c(halfU, halfV, y0)
  const b010 = c(-halfU, halfV, y0)
  const t000 = c(-halfU, -halfV, y1)
  const t100 = c(halfU, -halfV, y1)
  const t110 = c(halfU, halfV, y1)
  const t010 = c(-halfU, halfV, y1)
  pushTri(positions, indices, t000, t100, t110, 0, 1, 0)
  pushTri(positions, indices, t000, t110, t010, 0, 1, 0)
  pushTri(positions, indices, b000, b100, t100, 0, 0, -1)
  pushTri(positions, indices, b000, t100, t000, 0, 0, -1)
  pushTri(positions, indices, b100, b110, t110, 1, 0, 0)
  pushTri(positions, indices, b100, t110, t100, 1, 0, 0)
  pushTri(positions, indices, b110, b010, t010, 0, 0, 1)
  pushTri(positions, indices, b110, t010, t110, 0, 0, 1)
  pushTri(positions, indices, b010, b000, t000, -1, 0, 0)
  pushTri(positions, indices, b010, t000, t010, -1, 0, 0)
}

/**
 * 0–2 chimneys on a gabled OBB, seated on the roof slope near the ridge.
 */
function appendGabledChimneys(
  buildingId: string,
  obb: OBB,
  yEaves: number,
  riseExag: number,
  exag: number,
  positions: number[],
  indices: number[],
  push: (x: number, y: number, z: number) => number,
): number {
  const before = indices.length
  const { cx, cz, ux, uz, vx, vz, halfU, halfV } = obb
  const alongU = halfU >= halfV
  // Local long = ridge, short = across slopes
  const ru = alongU ? ux : vx
  const rz = alongU ? uz : vz
  const su = alongU ? vx : ux
  const sz = alongU ? vz : uz
  const halfLong = Math.max(halfU, halfV)
  const halfShort = Math.min(halfU, halfV)
  if (halfLong < 2.5 || halfShort < 1.2) return 0

  const roll = hash01(buildingId + ':chimney')
  // ~70% at least one chimney on classic houses
  let count = 0
  if (roll < 0.72) count = 1
  if (roll < 0.28) count = 2
  if (count === 0) return 0

  const stackH =
    (0.85 + hash01(buildingId + ':chH') * 0.55) * Math.min(exag, 2.2)
  const halfSide = 0.22 + hash01(buildingId + ':chW') * 0.08

  for (let i = 0; i < count; i++) {
    const u = (hash01(buildingId + `:chU${i}`) - 0.5) * halfLong * 1.1
    // Sit on one slope near the ridge (not at eaves)
    const side = hash01(buildingId + `:chS${i}`) < 0.5 ? 1 : -1
    const vAbs =
      halfShort * (0.12 + hash01(buildingId + `:chV${i}`) * 0.28)
    const v = side * vAbs
    // Roof surface height on gable: linear from eaves to ridge
    const ySurf = yEaves + riseExag * (1 - Math.min(1, vAbs / halfShort))
    const x = cx + u * ru + v * su
    const z = cz + u * rz + v * sz
    // Sink slightly into the slope so the stack doesn't float
    const y0 = ySurf - 0.15 * Math.min(exag, 2)
    addChimneyBox(
      positions,
      indices,
      push,
      x,
      z,
      y0,
      y0 + stackH,
      halfSide,
      halfSide,
      ru,
      rz,
      su,
      sz,
    )
  }
  return indices.length - before
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
 * Flat roofs: mat0 deck, mat1 parapet, mat2 clutter (10 hashed variants).
 */
export function createRoofGeometry(
  ringIn: [number, number][],
  yEaves: number,
  shape: RoofShape,
  riseExag: number,
  building?: Building,
  verticalExaggeration = 2.2,
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

  // Guard: skip pitched OBB only on clearly broken footprints (empty yard under OBB)
  const metrics = footprintMetrics(ringIn)
  let resolved: RoofShape = shape
  if (shape === 'pyramidal' && !metrics.squarish) resolved = 'flat'
  if (shape === 'gabled' && metrics.fill < 0.68) resolved = 'flat'

  let slopeCount = 0
  let gableCount = 0
  let parapetCount = 0
  let detailCount = 0
  let chimneyCount = 0

  if (resolved === 'flat') {
    buildFlatRoof(ring, yEaves, positions, indices, push)
    slopeCount = indices.length
    if (building) {
      const parapetIdx: number[] = []
      const detailIdx: number[] = []
      const yDeck = yEaves + 0.04
      appendFlatRoofDetails(
        flatRoofVariantForBuilding(building),
        ring,
        footprintOBB(ring, 0),
        yDeck,
        verticalExaggeration,
        push,
        parapetIdx,
        detailIdx,
      )
      parapetCount = parapetIdx.length
      detailCount = detailIdx.length
      for (const i of parapetIdx) indices.push(i)
      for (const i of detailIdx) indices.push(i)
    }
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
    slopeCount = indices.length
  } else if (resolved === 'gabled') {
    const obb = footprintOBB(ring, EAVES_OVERHANG_M)
    const parts = buildGabledOBB(
      obb,
      yEaves,
      riseExag,
      positions,
      indices,
      push,
    )
    slopeCount = parts.slopeCount
    gableCount = parts.gableCount
    if (building) {
      chimneyCount = appendGabledChimneys(
        building.id,
        obb,
        yEaves,
        riseExag,
        verticalExaggeration,
        positions,
        indices,
        push,
      )
    }
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
    slopeCount = indices.length
  }

  if (indices.length < 3) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.clearGroups()
  if (resolved === 'flat' && (parapetCount > 0 || detailCount > 0)) {
    // mat 0 = deck, 1 = parapet, 2 = vents/HVAC/solar
    geo.addGroup(0, slopeCount, 0)
    if (parapetCount > 0) geo.addGroup(slopeCount, parapetCount, 1)
    if (detailCount > 0) {
      geo.addGroup(slopeCount + parapetCount, detailCount, 2)
    }
  } else {
    // mat 0 = slopes; mat 1 = gable ends; mat 2 = chimneys
    geo.addGroup(0, slopeCount, 0)
    if (gableCount > 0) geo.addGroup(slopeCount, gableCount, 1)
    if (chimneyCount > 0) {
      geo.addGroup(slopeCount + gableCount, chimneyCount, 2)
    }
  }
  return geo
}
