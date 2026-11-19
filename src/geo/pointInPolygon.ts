/** Ray-cast point-in-polygon. ring is [x,z][], may be open or closed. */
function inRing(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0]
    const zi = ring[i][1]
    const xj = ring[j][0]
    const zj = ring[j][1]
    const intersect =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** rings[0] = outer, rest = holes. */
export function pointInPolygon(
  x: number,
  z: number,
  rings: [number, number][][],
): boolean {
  const outer = rings[0]
  if (!outer || outer.length < 3) return false
  if (!inRing(x, z, outer)) return false
  for (let h = 1; h < rings.length; h++) {
    const hole = rings[h]
    if (hole && hole.length >= 3 && inRing(x, z, hole)) return false
  }
  return true
}

export function ringsBBox(rings: [number, number][][]): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const outer = rings[0] ?? []
  for (const [x, z] of outer) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}
