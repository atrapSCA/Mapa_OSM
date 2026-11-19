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

/**
 * Lit window quads on façade walls.
 * yBase = building foot; wallHExag = wall height already exaggerated.
 */
export function createWindowGeometry(
  b: Building,
  yBase: number,
  wallHExag: number,
  roofShape: RoofShape,
): THREE.BufferGeometry | null {
  const kind = normalizeKind(b.kind)
  if (kind === 'garage') return null
  if (kind === 'church') return null
  if (!(wallHExag > 0.5)) return null

  const ring = openRing(b.rings[0] ?? [])
  if (ring.length < 3) return null

  const positions: number[] = []
  const indices: number[] = []

  const winW = kind === 'apartments' ? 1.35 : 1.1
  const winH = kind === 'apartments' ? 1.4 : 1.2
  const rows = Math.max(1, storeysForWindows(b.height, roofShape))
  // Most windows lit so façades read clearly from above
  const litChance = kind === 'industrial' ? 0.45 : 0.78

  const pitched = roofShape === 'gabled' || roofShape === 'pyramidal'
  const topMargin = wallHExag * (pitched ? 0.14 : 0.06)
  const usableH = Math.max(0.8, wallHExag - topMargin)
  const rowPitch = usableH / rows
  // Keep window height readable vs wall (exaggeration-aware)
  const exag = wallHExag / Math.max(2.5, Math.min(80, b.height))
  const winHEx = Math.min(Math.max(winH * exag, rowPitch * 0.35), rowPitch * 0.62)
  const sill0 = Math.min(0.9 * exag, rowPitch * 0.2)
  const outset = 0.22 // outside wall — avoids z-fight / buried quads

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

    // Outward normal (away from centroid)
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
        if (hash01(b.id, salt) > litChance) continue

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

        const base = positions.length / 3
        // Quad facing outward: a,b along edge, up
        positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0)
        // CCW when viewed from outside (along -normal): bottomL, bottomR, topR / bottomL, topR, topL
        // Edge a→c with outward n: from outside, a is right, c is left → flip to x1,x0 for CCW
        indices.push(base + 1, base, base + 3, base + 1, base + 3, base + 2)
      }
    }
  }

  if (indices.length < 3) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

const windowMat = new THREE.MeshStandardMaterial({
  color: '#ffe8a8',
  emissive: '#ffcc55',
  emissiveIntensity: 1.6,
  roughness: 0.35,
  metalness: 0,
  flatShading: true,
  toneMapped: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
  depthWrite: true,
})

export function getWindowMaterial(): THREE.MeshStandardMaterial {
  return windowMat
}
