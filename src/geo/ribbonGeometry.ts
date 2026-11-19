import * as THREE from 'three'
import type { ContinuousTerrainJson } from '@shared/tileFormat'
import { sampleTerrainHeight } from '@/terrain/sampleHeight'

/** Remove near-duplicate consecutive vertices. */
function dedupe(points: [number, number][], eps = 0.08): [number, number][] {
  if (points.length === 0) return []
  const out: [number, number][] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const q = out[out.length - 1]
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p)
  }
  return out
}

function closeIfNearlyClosed(
  points: [number, number][],
  gapMeters = 3,
): [number, number][] {
  if (points.length < 3) return points
  const a = points[0]
  const b = points[points.length - 1]
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1])
  if (dist === 0) return points
  if (dist <= gapMeters) {
    const copy = points.slice()
    copy[copy.length - 1] = [a[0], a[1]]
    return copy
  }
  return points
}

function isClosedRing(points: [number, number][]): boolean {
  if (points.length < 4) return false
  const a = points[0]
  const b = points[points.length - 1]
  return a[0] === b[0] && a[1] === b[1]
}

function polylineLength(points: [number, number][]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    )
  }
  return len
}

/**
 * Catmull-Rom spline through OSM nodes → smooth road / roundabout curve.
 * Samples approximately every `spacingMeters` along arc length.
 */
export function smoothPolyline(
  pointsIn: [number, number][],
  spacingMeters = 2.2,
  closedHint = false,
): [number, number][] {
  let points = dedupe(pointsIn)
  if (points.length < 2) return points

  const closed = closedHint || isClosedRing(points)
  const control = closed ? points.slice(0, -1) : points
  if (control.length < 2) return points

  // Straight 2-point segment: just densify linearly.
  if (control.length === 2) {
    const [a, b] = control
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(d / spacingMeters))
    const out: [number, number][] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    return out
  }

  const vecs = control.map(([x, z]) => new THREE.Vector3(x, 0, z))
  // centripetal: less overshoot on sharp OSM corners
  const curve = new THREE.CatmullRomCurve3(vecs, closed, 'centripetal', 0.5)
  const length = Math.max(curve.getLength(), polylineLength(control))
  const count = Math.max(
    control.length * 3,
    Math.ceil(length / Math.max(0.8, spacingMeters)),
  )
  const spaced = curve.getSpacedPoints(count)
  const out: [number, number][] = spaced.map((v) => [v.x, v.z])
  if (closed && out.length > 0) {
    out.push([out[0][0], out[0][1]])
  }
  return dedupe(out, 0.04)
}

function heightAt(
  terrain: ContinuousTerrainJson,
  x: number,
  z: number,
  exaggeration: number,
  liftMeters: number,
): number {
  return (sampleTerrainHeight(terrain, x, z) + liftMeters) * exaggeration
}

/** Extend open ends slightly so neighbouring road ways overlap at junctions. */
function extendOpenPolyline(
  points: [number, number][],
  extendMeters: number,
): [number, number][] {
  if (points.length < 2 || extendMeters <= 0) return points
  const out = points.map((p) => [p[0], p[1]] as [number, number])

  const extend = (atStart: boolean) => {
    if (out.length < 2) return
    if (atStart) {
      const a = out[0]
      const b = out[1]
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const ux = (a[0] - b[0]) / d
      const uz = (a[1] - b[1]) / d
      out[0] = [a[0] + ux * extendMeters, a[1] + uz * extendMeters]
    } else {
      const a = out[out.length - 2]
      const b = out[out.length - 1]
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const ux = (b[0] - a[0]) / d
      const uz = (b[1] - a[1]) / d
      out[out.length - 1] = [
        b[0] + ux * extendMeters,
        b[1] + uz * extendMeters,
      ]
    }
  }

  extend(true)
  extend(false)
  return out
}

/**
 * Smooth curved ribbon: Catmull-Rom centerline + continuous triangle strip.
 */
export function ribbonGeometry(
  pointsIn: [number, number][],
  width: number,
  terrain: ContinuousTerrainJson,
  exaggeration: number,
  liftMeters = 1.5,
): THREE.BufferGeometry | null {
  let raw = closeIfNearlyClosed(dedupe(pointsIn))
  if (raw.length < 2) return null

  const closed = isClosedRing(raw)
  // Denser sampling on compact loops (roundabouts).
  const bboxSpan = (() => {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of raw) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    return Math.hypot(maxX - minX, maxZ - minZ)
  })()
  const spacing =
    closed && bboxSpan < 120 ? 1.2 : closed ? 1.6 : 2.4

  const points = smoothPolyline(raw, spacing, closed)
  if (points.length < 2) return null

  const ring = isClosedRing(points)
  const poly = ring ? points.slice(0, -1) : points
  if (poly.length < 2) return null

  const half = Math.max(0.4, width / 2)
  // Slightly extend open ends so road ways seal at junctions (no path showing through).
  const polyDraw = ring
    ? poly
    : extendOpenPolyline(poly, Math.min(half * 0.35, 1.2))
  const n = polyDraw.length
  if (n < 2) return null

  const positions: number[] = []
  const indices: number[] = []

  // Continuous strip with averaged tangents → smooth curve sides
  for (let i = 0; i < n; i++) {
    const prev = polyDraw[ring ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const curr = polyDraw[i]
    const next = polyDraw[ring ? (i + 1) % n : Math.min(n - 1, i + 1)]

    let dx = next[0] - prev[0]
    let dz = next[1] - prev[1]
    if (!ring && i === 0) {
      dx = next[0] - curr[0]
      dz = next[1] - curr[1]
    } else if (!ring && i === n - 1) {
      dx = curr[0] - prev[0]
      dz = curr[1] - prev[1]
    }
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const px = -dz * half
    const pz = dx * half
    // Identical lift along strip → no shading steps at overlaps
    const y = heightAt(terrain, curr[0], curr[1], exaggeration, liftMeters)

    positions.push(curr[0] + px, y, curr[1] + pz)
    positions.push(curr[0] - px, y, curr[1] - pz)
  }

  const segCount = ring ? n : n - 1
  for (let i = 0; i < segCount; i++) {
    const a = i * 2
    const b = a + 1
    const j = ((i + 1) % n) * 2
    const c = j
    const d = j + 1
    indices.push(a, c, b, b, c, d)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** Merge many ribbons into one geometry (better draw-call count). */
export function mergeRibbons(
  segments: { points: [number, number][]; width: number }[],
  terrain: ContinuousTerrainJson,
  exaggeration: number,
  liftMeters = 1.5,
): THREE.BufferGeometry | null {
  const positions: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const seg of segments) {
    const g = ribbonGeometry(
      seg.points,
      seg.width,
      terrain,
      exaggeration,
      liftMeters,
    )
    if (!g) continue
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const idx = g.getIndex()
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset)
      }
    }
    vertexOffset += pos.count
    g.dispose()
  }

  if (positions.length === 0) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}
