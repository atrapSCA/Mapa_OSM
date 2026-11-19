import * as THREE from 'three'
import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import type { RoofShape } from './roofs'

function hash01(id: string, salt = 0): number {
  let h = 2166136261 ^ salt
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
 * Pitched includes attic as a row where the table lists podkroví.
 */
export function storeysForWindows(
  heightM: number,
  roofShape: RoofShape,
): number {
  const h = Math.max(2.5, Math.min(80, heightM))
  const pitched = roofShape === 'gabled' || roofShape === 'pyramidal'
  void pitched

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
 * yBase = building foot; wallHExag = full wall height already exaggerated.
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

  const ring = openRing(b.rings[0] ?? [])
  if (ring.length < 3) return null

  const positions: number[] = []
  const indices: number[] = []

  const winW = kind === 'apartments' ? 1.4 : 1.15
  const winH = kind === 'apartments' ? 1.5 : 1.25
  const rows = storeysForWindows(b.height, roofShape)
  const litChance = kind === 'industrial' ? 0.25 : 0.55

  const pitched = roofShape === 'gabled' || roofShape === 'pyramidal'
  const topMargin = wallHExag * (pitched ? 0.18 : 0.08)
  const usableH = Math.max(wallHExag - topMargin, winH * 1.2)
  const rowPitch = usableH / rows
  const sill0 = Math.min(
    1.0 * (wallHExag / Math.max(b.height, 2.5)),
    rowPitch * 0.25,
  )
  const winHEx = Math.min(
    winH * (wallHExag / Math.max(b.height, 2.5)),
    rowPitch * 0.55,
  )
  const outset = 0.06

  let salt = 1
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e]
    const c = ring[(e + 1) % ring.length]
    const dx = c[0] - a[0]
    const dz = c[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < winW * 1.8) continue

    let nx = -dz / len
    let nz = dx / len
    let cx = 0
    let cz = 0
    for (const p of ring) {
      cx += p[0]
      cz += p[1]
    }
    cx /= ring.length
    cz /= ring.length
    const mx = (a[0] + c[0]) / 2
    const mz = (a[1] + c[1]) / 2
    if ((mx - cx) * nx + (mz - cz) * nz < 0) {
      nx = -nx
      nz = -nz
    }

    const margin = winW * 0.7
    const usable = len - 2 * margin
    if (usable < winW) continue
    const count = Math.max(1, Math.floor(usable / (winW * 1.55)))

    for (let i = 0; i < count; i++) {
      for (let f = 0; f < rows; f++) {
        salt++
        if (hash01(b.id, salt) > litChance) continue

        const tCenter = margin / len + ((i + 0.5) / count) * (usable / len)
        const halfTw = winW / (2 * len)
        const t0 = tCenter - halfTw
        const t1 = tCenter + halfTw
        if (t0 < 0 || t1 > 1) continue

        const y0 = yBase + sill0 + f * rowPitch
        const y1 = y0 + winHEx
        if (y1 > yBase + wallHExag - topMargin * 0.35) continue

        const x0 = a[0] + dx * t0 + nx * outset
        const z0 = a[1] + dz * t0 + nz * outset
        const x1 = a[0] + dx * t1 + nx * outset
        const z1 = a[1] + dz * t1 + nz * outset

        const base = positions.length / 3
        positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0)
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
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
  color: '#ffe6a0',
  emissive: '#ffcc66',
  emissiveIntensity: 1.35,
  roughness: 0.4,
  metalness: 0,
  flatShading: true,
  toneMapped: false,
})

export function getWindowMaterial(): THREE.MeshStandardMaterial {
  return windowMat
}
