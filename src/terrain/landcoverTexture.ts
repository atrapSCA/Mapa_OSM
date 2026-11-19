import * as THREE from 'three'
import type { ContinuousTerrainJson } from '@shared/tileFormat'

export type LandcoverPoly = {
  rings: [number, number][][]
  color: string
}

const DEFAULT_SIZE = 2048

/** Local XZ → canvas pixel (row 0 / v=0 = north = minZ). */
function toPx(
  x: number,
  z: number,
  minX: number,
  spanX: number,
  minZ: number,
  spanZ: number,
  size: number,
): [number, number] {
  const u = (x - minX) / (spanX || 1)
  const v = (z - minZ) / (spanZ || 1)
  return [u * size, v * size]
}

function drawPoly(
  ctx: CanvasRenderingContext2D,
  rings: [number, number][][],
  color: string,
  minX: number,
  spanX: number,
  minZ: number,
  spanZ: number,
  size: number,
) {
  if (!rings[0] || rings[0].length < 3) return
  ctx.fillStyle = color
  ctx.beginPath()
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]
    if (!ring || ring.length < 3) continue
    const [x0, z0] = ring[0]
    const [px0, py0] = toPx(x0, z0, minX, spanX, minZ, spanZ, size)
    ctx.moveTo(px0, py0)
    for (let i = 1; i < ring.length; i++) {
      const [x, z] = ring[i]
      const [px, py] = toPx(x, z, minX, spanX, minZ, spanZ, size)
      ctx.lineTo(px, py)
    }
    ctx.closePath()
  }
  ctx.fill('evenodd')
}

/**
 * Bake nature + water polygons into one canvas texture on the terrain UV space.
 * Hypsometric DEM colors are painted first as background.
 */
export function buildLandcoverTexture(
  terrain: ContinuousTerrainJson,
  nature: LandcoverPoly[],
  water: LandcoverPoly[],
  useHypsometric: boolean,
  size = DEFAULT_SIZE,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const { boundsLocal, resolutionX, resolutionZ, colors } = terrain
  const { minX, maxX, minZ, maxZ } = boundsLocal
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  const nX = resolutionX + 1

  // Background: hypsometric (or flat green) sampled from DEM grid
  const img = ctx.createImageData(size, size)
  const data = img.data
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5) / size
    const row = Math.min(resolutionZ, Math.max(0, v * resolutionZ))
    const r0 = Math.floor(row)
    const r1 = Math.min(resolutionZ, r0 + 1)
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size
      const col = Math.min(resolutionX, Math.max(0, u * resolutionX))
      const c0 = Math.floor(col)
      const c1 = Math.min(resolutionX, c0 + 1)
      const i00 = r0 * nX + c0
      let r = 140
      let g = 158
      let b = 122
      if (useHypsometric && colors?.[i00]) {
        const hex = colors[i00]
        r = parseInt(hex.slice(1, 3), 16)
        g = parseInt(hex.slice(3, 5), 16)
        b = parseInt(hex.slice(5, 7), 16)
        // slight blend with neighbor for less blocky base
        if (colors[r0 * nX + c1]) {
          const h2 = colors[r0 * nX + c1]
          r = (r + parseInt(h2.slice(1, 3), 16)) >> 1
          g = (g + parseInt(h2.slice(3, 5), 16)) >> 1
          b = (b + parseInt(h2.slice(5, 7), 16)) >> 1
        }
        void r1
      }
      const o = (py * size + px) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  for (const p of nature) {
    drawPoly(ctx, p.rings, p.color, minX, spanX, minZ, spanZ, size)
  }
  for (const p of water) {
    drawPoly(ctx, p.rings, p.color, minX, spanX, minZ, spanZ, size)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}
