import type { ContinuousTerrainJson } from '@shared/tileFormat'

/** Bilinear sample of DEM height (meters) at local XZ. */
export function sampleTerrainHeight(
  terrain: ContinuousTerrainJson,
  localX: number,
  localZ: number,
): number {
  const { boundsLocal, resolutionX, resolutionZ, heights } = terrain
  const nX = resolutionX + 1

  const u =
    (localX - boundsLocal.minX) / (boundsLocal.maxX - boundsLocal.minX || 1)
  // local Z: north = minZ (row 0), south = maxZ
  const v =
    (localZ - boundsLocal.minZ) / (boundsLocal.maxZ - boundsLocal.minZ || 1)

  const x = Math.min(resolutionX, Math.max(0, u * resolutionX))
  const y = Math.min(resolutionZ, Math.max(0, v * resolutionZ))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(resolutionX, x0 + 1)
  const y1 = Math.min(resolutionZ, y0 + 1)
  const tx = x - x0
  const ty = y - y0

  const h00 = heights[y0 * nX + x0] ?? 0
  const h10 = heights[y0 * nX + x1] ?? 0
  const h01 = heights[y1 * nX + x0] ?? 0
  const h11 = heights[y1 * nX + x1] ?? 0
  const a = h00 * (1 - tx) + h10 * tx
  const b = h01 * (1 - tx) + h11 * tx
  return a * (1 - ty) + b * ty
}
