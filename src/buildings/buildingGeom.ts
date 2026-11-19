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

export function buildingGeometry(
  b: Building,
  terrain: ContinuousTerrainJson,
  exaggeration: number,
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

    const height = Math.max(2.5, Math.min(80, b.height)) * exaggeration
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
    })
    geo.rotateX(-Math.PI / 2)

    const maxElev = footprintMaxElev(outer, terrain)
    const y0 = maxElev * exaggeration + 0.08
    geo.translate(0, y0, 0)
    return geo
  } catch {
    return null
  }
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
