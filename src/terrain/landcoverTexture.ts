import * as THREE from 'three'
import type { ContinuousTerrainJson } from '@shared/tileFormat'

export type LandcoverPoly = {
  rings: [number, number][][]
  color: string
}

const DEFAULT_SIZE = 2048

/** Local XZ → canvas pixel (py=0 = north = minZ, matches DEM UV v). */
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

function drawRing(
  ctx: CanvasRenderingContext2D,
  ring: [number, number][],
  minX: number,
  spanX: number,
  minZ: number,
  spanZ: number,
  size: number,
) {
  if (ring.length < 3) return
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

/**
 * Outer filled; holes painted with `holeFill` (terrain base).
 * Do NOT use destination-out — with alpha:false that leaves opaque black flecks.
 */
function drawPoly(
  ctx: CanvasRenderingContext2D,
  rings: [number, number][][],
  color: string,
  holeFill: string,
  minX: number,
  spanX: number,
  minZ: number,
  spanZ: number,
  size: number,
) {
  const outer = rings[0]
  if (!outer || outer.length < 3) return

  ctx.fillStyle = color
  ctx.beginPath()
  drawRing(ctx, outer, minX, spanX, minZ, spanZ, size)
  ctx.fill('nonzero')

  if (rings.length < 2) return
  // Clip to outer so misplaced multipolygon inners can't erase neighbours.
  ctx.save()
  ctx.beginPath()
  drawRing(ctx, outer, minX, spanX, minZ, spanZ, size)
  ctx.clip()
  ctx.fillStyle = holeFill
  for (let r = 1; r < rings.length; r++) {
    const hole = rings[r]
    if (!hole || hole.length < 3) continue
    ctx.beginPath()
    drawRing(ctx, hole, minX, spanX, minZ, spanZ, size)
    ctx.fill('nonzero')
  }
  ctx.restore()
}

/**
 * Bake hypsometric base + nature + water into one canvas texture.
 * UV: u = west→east, v = north→south (same as terrain mesh).
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
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) {
    throw new Error('2D canvas unavailable for landcover')
  }

  const { boundsLocal, colors } = terrain
  const { minX, maxX, minZ, maxZ } = boundsLocal
  const spanX = maxX - minX
  const spanZ = maxZ - minZ

  // Solid base — no per-DEM-cell fillRect (that caused the visible grid).
  // Optional soft hypsometric: average a few DEM samples into one flat tint.
  let base = '#9bb887'
  if (useHypsometric && colors && colors.length > 0) {
    let r = 0
    let g = 0
    let b = 0
    const step = Math.max(1, Math.floor(colors.length / 64))
    let n = 0
    for (let i = 0; i < colors.length; i += step) {
      const hex = colors[i]
      r += parseInt(hex.slice(1, 3), 16)
      g += parseInt(hex.slice(3, 5), 16)
      b += parseInt(hex.slice(5, 7), 16)
      n++
    }
    if (n > 0) {
      base = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`
    }
  }
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  for (const p of nature) {
    drawPoly(ctx, p.rings, p.color, base, minX, spanX, minZ, spanZ, size)
  }
  for (const p of water) {
    drawPoly(ctx, p.rings, p.color, base, minX, spanX, minZ, spanZ, size)
  }

  const tex = new THREE.CanvasTexture(canvas)
  // Our v grows north→south like canvas y; disable Three's default flip.
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}
