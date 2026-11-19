/**
 * Terrarium DEM tiles (AWS Open Data) — global coverage, free, same source for Rakovník → world.
 * Encoding: elevation_m = (R * 256 + G + B / 256) - 32768
 * URL: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 */

import sharp from 'sharp'
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import type { TileCoord } from '../shared/geo.ts'

const TERRARIUM_BASE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'

export function terrariumUrl({ z, x, y }: TileCoord): string {
  return `${TERRARIUM_BASE}/${z}/${x}/${y}.png`
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

export async function downloadTerrariumPng(
  tile: TileCoord,
  destPng: string,
): Promise<void> {
  await mkdir(path.dirname(destPng), { recursive: true })
  try {
    await access(destPng)
    return
  } catch {
    /* download */
  }
  const url = terrariumUrl(tile)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`DEM download failed ${url}: ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(destPng, buf)
}

/** Returns 256×256 elevations (Terrarium native). */
export async function readTerrariumHeights(
  pngPath: string,
): Promise<{ width: number; height: number; heights: Float32Array }> {
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  const heights = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * channels
    heights[i] = decodeTerrarium(data[o], data[o + 1], data[o + 2])
  }
  return { width, height, heights }
}

export async function loadOrFetchDem(
  tile: TileCoord,
  rawDir: string,
): Promise<{ width: number; height: number; heights: Float32Array }> {
  const pngPath = path.join(rawDir, 'dem', `${tile.z}`, `${tile.x}`, `${tile.y}.png`)
  await downloadTerrariumPng(tile, pngPath)
  return readTerrariumHeights(pngPath)
}

/** Bilinear sample on a height grid. */
export function sampleHeight(
  heights: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = Math.min(width - 1, Math.max(0, u * (width - 1)))
  const y = Math.min(height - 1, Math.max(0, v * (height - 1)))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const h00 = heights[y0 * width + x0]
  const h10 = heights[y0 * width + x1]
  const h01 = heights[y1 * width + x0]
  const h11 = heights[y1 * width + x1]
  const a = h00 * (1 - tx) + h10 * tx
  const b = h01 * (1 - tx) + h11 * tx
  return a * (1 - ty) + b * ty
}

export async function writeJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data), 'utf8')
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}
