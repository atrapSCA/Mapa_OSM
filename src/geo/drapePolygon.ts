import * as THREE from 'three'
import type { ContinuousTerrainJson } from '@shared/tileFormat'
import { sampleTerrainHeight } from '@/terrain/sampleHeight'

function ringArea(ring: [number, number][]): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return a / 2
}

/** Ensure outer CCW and holes CW for Shape triangulation. */
function orientRing(
  ring: [number, number][],
  wantPositive: boolean,
): [number, number][] {
  const area = ringArea(ring)
  const positive = area > 0
  if (positive === wantPositive) return ring
  return ring.slice().reverse()
}

/** Insert vertices so no edge is longer than maxSeg (keeps outline smooth). */
function densifyRing(
  ring: [number, number][],
  maxSeg: number,
): [number, number][] {
  if (ring.length < 2) return ring
  const out: [number, number][] = []
  const n = ring.length
  const closed =
    ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]
  const last = closed ? n - 1 : n

  for (let i = 0; i < last; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    out.push(a)
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len <= maxSeg) continue
    const steps = Math.ceil(len / maxSeg)
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      out.push([a[0] + dx * t, a[1] + dz * t])
    }
  }
  if (closed || out.length === 0) {
    const first = out[0] ?? ring[0]
    out.push([first[0], first[1]])
  } else {
    out.push(ring[last - 1])
  }
  return out
}

function terrainCellSize(terrain: ContinuousTerrainJson): number {
  const { boundsLocal, resolutionX, resolutionZ } = terrain
  const sx = (boundsLocal.maxX - boundsLocal.minX) / resolutionX
  const sz = (boundsLocal.maxZ - boundsLocal.minZ) / resolutionZ
  return Math.min(sx, sz)
}

/**
 * Midpoint-subdivide triangles in XZ until edges ≤ maxEdge.
 * Positions are [x,z] pairs; returns flat [x,z,...] + index list.
 */
function subdivideXZ(
  verts: number[],
  indices: number[],
  maxEdge: number,
  maxRounds = 6,
): { verts: number[]; indices: number[] } {
  let v = verts
  let idx = indices
  const maxEdge2 = maxEdge * maxEdge

  for (let round = 0; round < maxRounds; round++) {
    const midCache = new Map<string, number>()
    const getMid = (i0: number, i1: number): number => {
      const a = Math.min(i0, i1)
      const b = Math.max(i0, i1)
      const key = `${a}_${b}`
      const hit = midCache.get(key)
      if (hit !== undefined) return hit
      const x = (v[a * 2] + v[b * 2]) * 0.5
      const z = (v[a * 2 + 1] + v[b * 2 + 1]) * 0.5
      const id = v.length / 2
      v.push(x, z)
      midCache.set(key, id)
      return id
    }

    const next: number[] = []
    let splitAny = false
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t]
      const i1 = idx[t + 1]
      const i2 = idx[t + 2]
      const d01 =
        (v[i0 * 2] - v[i1 * 2]) ** 2 + (v[i0 * 2 + 1] - v[i1 * 2 + 1]) ** 2
      const d12 =
        (v[i1 * 2] - v[i2 * 2]) ** 2 + (v[i1 * 2 + 1] - v[i2 * 2 + 1]) ** 2
      const d20 =
        (v[i2 * 2] - v[i0 * 2]) ** 2 + (v[i2 * 2 + 1] - v[i0 * 2 + 1]) ** 2

      const s01 = d01 > maxEdge2
      const s12 = d12 > maxEdge2
      const s20 = d20 > maxEdge2
      const nSplit = (s01 ? 1 : 0) + (s12 ? 1 : 0) + (s20 ? 1 : 0)

      if (nSplit === 0) {
        next.push(i0, i1, i2)
        continue
      }
      splitAny = true
      // Always 4-split when any edge is long → uniform facets
      const m01 = getMid(i0, i1)
      const m12 = getMid(i1, i2)
      const m20 = getMid(i2, i0)
      next.push(i0, m01, m20)
      next.push(i1, m12, m01)
      next.push(i2, m20, m12)
      next.push(m01, m12, m20)
    }
    idx = next
    if (!splitAny) break
  }
  return { verts: v, indices: idx }
}

/**
 * Drape polygon onto DEM with dense facets (follows height, keeps OSM outline).
 * Not a terrain-grid stamp — avoids the checkered square look.
 */
export function drapePolygonGeometry(
  rings: [number, number][][],
  terrain: ContinuousTerrainJson,
  exaggeration: number,
  liftMeters: number,
): THREE.BufferGeometry | null {
  try {
    const rawOuter = rings[0]
    if (!rawOuter || rawOuter.length < 3) return null

    const cell = terrainCellSize(terrain)
    // ~½ cell → facets track DEM without axis-aligned pixel edges
    const maxSeg = Math.max(25, cell * 0.5)

    const outer = densifyRing(orientRing(rawOuter, true), maxSeg)
    const shape = new THREE.Shape()
    shape.moveTo(outer[0][0], outer[0][1])
    for (let i = 1; i < outer.length; i++) {
      shape.lineTo(outer[i][0], outer[i][1])
    }
    shape.closePath()

    for (let h = 1; h < rings.length; h++) {
      const holeRaw = rings[h]
      if (!holeRaw || holeRaw.length < 3) continue
      const hole = densifyRing(orientRing(holeRaw, false), maxSeg)
      const path = new THREE.Path()
      path.moveTo(hole[0][0], hole[0][1])
      for (let i = 1; i < hole.length; i++) {
        path.lineTo(hole[i][0], hole[i][1])
      }
      path.closePath()
      shape.holes.push(path)
    }

    const base = new THREE.ShapeGeometry(shape, 2)
    const pos = base.attributes.position
    const baseIdx = base.getIndex()
    if (!pos || pos.count === 0 || !baseIdx) {
      base.dispose()
      return null
    }

    const verts: number[] = []
    for (let i = 0; i < pos.count; i++) {
      verts.push(pos.getX(i), pos.getY(i)) // Shape uses XY → our XZ
    }
    const indices: number[] = []
    for (let i = 0; i < baseIdx.count; i++) indices.push(baseIdx.getX(i))
    base.dispose()

    const dense = subdivideXZ(verts, indices, maxSeg)

    const positions = new Float32Array((dense.verts.length / 2) * 3)
    for (let i = 0; i < dense.verts.length / 2; i++) {
      const x = dense.verts[i * 2]
      const z = dense.verts[i * 2 + 1]
      const y =
        (sampleTerrainHeight(terrain, x, z) + liftMeters) * exaggeration
      const o = i * 3
      positions[o] = x
      positions[o + 1] = y
      positions[o + 2] = z
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const indexArray =
      dense.verts.length / 2 > 65535
        ? new Uint32Array(dense.indices)
        : new Uint16Array(dense.indices)
    geo.setIndex(new THREE.BufferAttribute(indexArray, 1))
    geo.computeVertexNormals()
    return geo
  } catch {
    return null
  }
}

export function mergeGeometries(
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry | null {
  if (geos.length === 0) return null

  const positions: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) {
      g.dispose()
      continue
    }
    const idx = g.getIndex()
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset)
      }
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(vertexOffset + i)
    }
    vertexOffset += pos.count
    g.dispose()
  }

  if (positions.length === 0) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const indexArray =
    vertexOffset > 65535
      ? new Uint32Array(indices)
      : new Uint16Array(indices)
  geo.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geo.computeVertexNormals()
  return geo
}
