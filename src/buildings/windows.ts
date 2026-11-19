import * as THREE from 'three'
import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import type { RoofShape } from './roofs'

function hash01(id: string, salt = 0): number {
  let h = 2166136261 ^ (salt * 2654435761)
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring.slice()
  const last = ring.length - 1
  if (ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]) {
    return ring.slice(0, last)
  }
  return ring.slice()
}

/**
 * Window storey rows from CZ height→floors table (flat vs pitched).
 */
export function storeysForWindows(
  heightM: number,
  _roofShape: RoofShape,
): number {
  const h = Math.max(2.5, Math.min(80, heightM))
  if (h < 4.5) return 1
  if (h < 6.5) return 2
  if (h < 9.5) return 3
  if (h < 12.5) return 4
  if (h < 16) return 5
  if (h < 22) return 6
  if (h < 28) return 8
  if (h < 35) return 10
  if (h < 45) return 12
  return Math.min(18, Math.round(h / 3.2))
}

export type WindowGeometries = {
  /** Daytime dark glass — majority. */
  dark: THREE.BufferGeometry | null
  /** Sparse lit interiors. */
  lit: THREE.BufferGeometry | null
}

function flushGeo(
  positions: number[],
  indices: number[],
): THREE.BufferGeometry | null {
  if (indices.length < 3) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/**
 * Window quads on façades. Most are dark (day); few lit.
 */
export function createWindowGeometry(
  b: Building,
  yBase: number,
  wallHExag: number,
  roofShape: RoofShape,
): WindowGeometries {
  const empty: WindowGeometries = { dark: null, lit: null }
  const kind = normalizeKind(b.kind)
  if (kind === 'garage') return empty
  if (kind === 'church') return empty
  if (!(wallHExag > 0.5)) return empty

  const ring = openRing(b.rings[0] ?? [])
  if (ring.length < 3) return empty

  const darkPos: number[] = []
  const darkIdx: number[] = []
  const litPos: number[] = []
  const litIdx: number[] = []

  const winW = kind === 'apartments' ? 1.35 : 1.1
  const winH = kind === 'apartments' ? 1.4 : 1.2
  const rows = Math.max(1, storeysForWindows(b.height, roofShape))
  // Daytime: only a small share glowing
  const litChance = kind === 'industrial' ? 0.06 : 0.12

  const pitched = roofShape === 'gabled' || roofShape === 'pyramidal'
  const topMargin = wallHExag * (pitched ? 0.14 : 0.06)
  const usableH = Math.max(0.8, wallHExag - topMargin)
  const rowPitch = usableH / rows
  const exag = wallHExag / Math.max(2.5, Math.min(80, b.height))
  const winHEx = Math.min(Math.max(winH * exag, rowPitch * 0.35), rowPitch * 0.62)
  const sill0 = Math.min(0.9 * exag, rowPitch * 0.2)
  const outset = 0.22

  let cx = 0
  let cz = 0
  for (const p of ring) {
    cx += p[0]
    cz += p[1]
  }
  cx /= ring.length
  cz /= ring.length

  let salt = 0
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e]
    const c = ring[(e + 1) % ring.length]
    const dx = c[0] - a[0]
    const dz = c[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < winW * 1.6) continue

    let nx = -dz / len
    let nz = dx / len
    const mx = (a[0] + c[0]) / 2
    const mz = (a[1] + c[1]) / 2
    if ((mx - cx) * nx + (mz - cz) * nz < 0) {
      nx = -nx
      nz = -nz
    }

    const margin = Math.min(winW * 0.55, len * 0.12)
    const usable = len - 2 * margin
    if (usable < winW * 0.85) continue
    const count = Math.max(1, Math.floor(usable / (winW * 1.45)))

    for (let i = 0; i < count; i++) {
      for (let f = 0; f < rows; f++) {
        salt++
        const lit = hash01(b.id, salt) < litChance

        const tCenter = margin / len + ((i + 0.5) / count) * (usable / len)
        const halfTw = (winW * 0.5) / len
        const t0 = tCenter - halfTw
        const t1 = tCenter + halfTw
        if (t0 < 0.01 || t1 > 0.99) continue

        const y0 = yBase + sill0 + f * rowPitch
        const y1 = y0 + winHEx
        if (y1 > yBase + wallHExag - 0.05) continue

        const x0 = a[0] + dx * t0 + nx * outset
        const z0 = a[1] + dz * t0 + nz * outset
        const x1 = a[0] + dx * t1 + nx * outset
        const z1 = a[1] + dz * t1 + nz * outset

        const positions = lit ? litPos : darkPos
        const indices = lit ? litIdx : darkIdx
        const base = positions.length / 3
        positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0)
        indices.push(base + 1, base, base + 3, base + 1, base + 3, base + 2)
      }
    }
  }

  return {
    dark: flushGeo(darkPos, darkIdx),
    lit: flushGeo(litPos, litIdx),
  }
}

const darkWindowMat = new THREE.MeshStandardMaterial({
  color: '#3a4550',
  emissive: '#000000',
  emissiveIntensity: 0,
  roughness: 0.35,
  metalness: 0.15,
  flatShading: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
})

const litWindowMat = new THREE.MeshStandardMaterial({
  color: '#ffe8a8',
  emissive: '#ffcc55',
  emissiveIntensity: 1.4,
  roughness: 0.35,
  metalness: 0,
  flatShading: true,
  toneMapped: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
})

export function getDarkWindowMaterial(): THREE.MeshStandardMaterial {
  return darkWindowMat
}

export function getLitWindowMaterial(): THREE.MeshStandardMaterial {
  return litWindowMat
}

/** @deprecated use getDarkWindowMaterial / getLitWindowMaterial */
export function getWindowMaterial(): THREE.MeshStandardMaterial {
  return litWindowMat
}
