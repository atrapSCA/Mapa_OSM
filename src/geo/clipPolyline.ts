import { pointInPolygon, ringsBBox } from './pointInPolygon'

type Poly = { rings: [number, number][][] }

function pointInAny(x: number, z: number, polys: Poly[]): boolean {
  for (const p of polys) {
    const bb = ringsBBox(p.rings)
    if (
      x < bb.minX ||
      x > bb.maxX ||
      z < bb.minZ ||
      z > bb.maxZ
    ) {
      continue
    }
    if (pointInPolygon(x, z, p.rings)) return true
  }
  return false
}

/**
 * Keep only polyline runs that lie outside the given polygons
 * (e.g. streams under lakes should disappear on the water surface).
 */
export function clipPolylineOutsidePolygons(
  points: [number, number][],
  polygons: Poly[],
): [number, number][][] {
  if (points.length < 2) return []
  if (polygons.length === 0) return [points]

  const segments: [number, number][][] = []
  let run: [number, number][] = []

  for (const pt of points) {
    const inside = pointInAny(pt[0], pt[1], polygons)
    if (!inside) {
      run.push(pt)
    } else if (run.length >= 2) {
      segments.push(run)
      run = []
    } else {
      run = []
    }
  }
  if (run.length >= 2) segments.push(run)
  return segments
}
