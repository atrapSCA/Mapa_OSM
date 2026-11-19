import * as THREE from 'three'
import type { Building, ContinuousTerrainJson } from '@shared/tileFormat'
import { pointInPolygon, ringsBBox } from '@/geo/pointInPolygon'
import { sampleTerrainHeight } from '@/terrain/sampleHeight'

function ringArea(ring: [number, number][]): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return a / 2
}

export function ringAreaAbs(ring: [number, number][]): number {
  return Math.abs(ringArea(ring))
}

/** Max DEM under the footprint so flat-bottom blocks sit above the slope. */
export function footprintMaxElev(
  ring: [number, number][],
  terrain: ContinuousTerrainJson,
): number {
  let maxElev = -Infinity
  const bump = (x: number, z: number) => {
    maxElev = Math.max(maxElev, sampleTerrainHeight(terrain, x, z))
  }

  for (const [x, z] of ring) bump(x, z)

  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i]
    const [bx, bz] = ring[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const steps = Math.max(1, Math.ceil(len / 2))
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      bump(ax + (bx - ax) * t, az + (bz - az) * t)
    }
  }

  const { minX, maxX, minZ, maxZ } = ringsBBox([ring])
  const span = Math.max(maxX - minX, maxZ - minZ, 1)
  const step = Math.min(4, Math.max(1.5, span / 8))
  for (let x = minX; x <= maxX; x += step) {
    for (let z = minZ; z <= maxZ; z += step) {
      if (pointInPolygon(x, z, [ring])) bump(x, z)
    }
  }

  return Number.isFinite(maxElev) ? maxElev : 0
}

export function footprintCentroid(ring: [number, number][]): [number, number] {
  let sx = 0
  let sz = 0
  let n = 0
  const last = ring.length - 1
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[last][0] &&
    ring[0][1] === ring[last][1]
  const end = closed ? last : ring.length
  for (let i = 0; i < end; i++) {
    sx += ring[i][0]
    sz += ring[i][1]
    n++
  }
  if (n === 0) return [0, 0]
  return [sx / n, sz / n]
}

/** World Y of building base (terrain max under footprint + lift). */
export function buildingBaseY(
  b: Building,
  terrain: ContinuousTerrainJson,
  exaggeration: number,
): number {
  const ring = b.rings[0]
  if (!ring) return 0
  return footprintMaxElev(ring, terrain) * exaggeration + 0.08
}

/**
 * Extruded walls. `wallHeightM` is unexaggerated metres to eaves
 * (full building height when no separate pitched roof).
 * When `wallsOnly`, roof/floor cap triangles are dropped (roof mesh added separately).
 */
export function buildingGeometry(
  b: Building,
  terrain: ContinuousTerrainJson,
  exaggeration: number,
  wallHeightM?: number,
  wallsOnly = false,
): THREE.BufferGeometry | null {
  try {
    const raw = b.rings[0]
    if (!raw || raw.length < 4) return null

    const outer = ringArea(raw) > 0 ? raw : raw.slice().reverse()
    const shape = new THREE.Shape()
    shape.moveTo(outer[0][0], -outer[0][1])
    for (let i = 1; i < outer.length; i++) {
      shape.lineTo(outer[i][0], -outer[i][1])
    }
    shape.closePath()

    for (let h = 1; h < b.rings.length; h++) {
      const holeRaw = b.rings[h]
      if (!holeRaw || holeRaw.length < 3) continue
      const hole = ringArea(holeRaw) < 0 ? holeRaw : holeRaw.slice().reverse()
      const path = new THREE.Path()
      path.moveTo(hole[0][0], -hole[0][1])
      for (let i = 1; i < hole.length; i++) {
        path.lineTo(hole[i][0], -hole[i][1])
      }
      path.closePath()
      shape.holes.push(path)
    }

    const hM = wallHeightM ?? Math.max(2.5, Math.min(80, b.height))
    const height = Math.max(1.5, hM) * exaggeration
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
    })
    geo.rotateX(-Math.PI / 2)

    const y0 = buildingBaseY(b, terrain, exaggeration)
    geo.translate(0, y0, 0)
    // UV in world metres + material groups: 0 = walls, 1 = roof/floor caps
    applyMeterUVsAndGroups(geo, wallsOnly)
    return geo
  } catch {
    return null
  }
}

/**
 * Rebuild UVs so 1 UV unit = 1 metre (texture.repeat = 1/tileSizeM).
 * Split index buffer into wall (mat 0) and roof/floor (mat 1) groups.
 */
function applyMeterUVsAndGroups(
  geo: THREE.BufferGeometry,
  wallsOnly = false,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex()
  if (!pos || !idx) return

  const uv = new Float32Array(pos.count * 2)
  const wallIdx: number[] = []
  const roofIdx: number[] = []

  const ax = new THREE.Vector3()
  const bx = new THREE.Vector3()
  const cx = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const n = new THREE.Vector3()

  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t)
    const i1 = idx.getX(t + 1)
    const i2 = idx.getX(t + 2)
    ax.fromBufferAttribute(pos, i0)
    bx.fromBufferAttribute(pos, i1)
    cx.fromBufferAttribute(pos, i2)
    e1.subVectors(bx, ax)
    e2.subVectors(cx, ax)
    n.crossVectors(e1, e2).normalize()

    const isRoof = Math.abs(n.y) > 0.55
    if (isRoof) {
      for (const i of [i0, i1, i2]) {
        uv[i * 2] = pos.getX(i)
        uv[i * 2 + 1] = pos.getZ(i)
      }
      if (!wallsOnly) roofIdx.push(i0, i1, i2)
    } else {
      const useZ = Math.abs(n.x) >= Math.abs(n.z)
      for (const i of [i0, i1, i2]) {
        uv[i * 2] = useZ ? pos.getZ(i) : pos.getX(i)
        uv[i * 2 + 1] = pos.getY(i)
      }
      wallIdx.push(i0, i1, i2)
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  const merged = wallsOnly ? wallIdx : wallIdx.concat(roofIdx)
  geo.setIndex(merged)
  geo.clearGroups()
  if (wallIdx.length) geo.addGroup(0, wallIdx.length, 0)
  if (!wallsOnly && roofIdx.length) {
    geo.addGroup(wallIdx.length, roofIdx.length, 1)
  }
  geo.computeVertexNormals()
}

/** World-space AABB corners (8) of the extruded building for screen projection. */
export function buildingWorldCorners(
  b: Building,
  terrain: ContinuousTerrainJson,
  exaggeration: number,
): THREE.Vector3[] {
  const ring = b.rings[0]
  if (!ring || ring.length < 3) return []
  const { minX, maxX, minZ, maxZ } = ringsBBox([ring])
  const maxElev = footprintMaxElev(ring, terrain)
  const h = Math.max(2.5, Math.min(80, b.height)) * exaggeration
  const y0 = maxElev * exaggeration + 0.08
  const y1 = y0 + h
  const xs = [minX, maxX]
  const zs = [minZ, maxZ]
  const ys = [y0, y1]
  const out: THREE.Vector3[] = []
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) out.push(new THREE.Vector3(x, y, z))
    }
  }
  return out
}
