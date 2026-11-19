import * as THREE from 'three'
import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'

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
 * Lit window quads on façade walls (hash-picked so the town feels inhabited).
 * yBase = building foot; wallHExag = full wall height already exaggerated.
 */
export function createWindowGeometry(
  b: Building,
  yBase: number,
  wallHExag: number,
): THREE.BufferGeometry | null {
  const kind = normalizeKind(b.kind)
  // Garages / industrial — few or no domestic windows
  if (kind === 'garage') return null
  if (kind === 'church') return null

  const ring = openRing(b.rings[0] ?? [])
  if (ring.length < 3) return null

  const positions: number[] = []
  const indices: number[] = []

  const winW = kind === 'apartments' ? 1.4 : 1.15
  const winH = kind === 'apartments' ? 1.5 : 1.25
  const sill = 1.0 // metres above floor (pre-exag scale via wallHExag / height)
  const floorH = 3.0
  const floors = Math.max(1, Math.min(12, Math.floor(b.height / floorH)))
  const litChance = kind === 'industrial' ? 0.25 : 0.55

  // Scale sill/window by exaggeration implied in wallHExag vs b.height
  const exag = wallHExag / Math.max(2.5, Math.min(80, b.height))
  const winWEx = winW
  const winHEx = winH * exag
  const sillEx = sill * exag
  const floorEx = floorH * exag
  const outset = 0.06 // sit slightly outside the wall to avoid z-fight

  let salt = 1
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e]
    const c = ring[(e + 1) % ring.length]
    const dx = c[0] - a[0]
    const dz = c[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < winW * 1.8) continue

    const tx = dx / len
    const tz = dz / len
    // Outward normal in XZ (ring assumed CCW → right of edge is outside? OSM often CW)
    // Use left-of-edge ( -tz, tx ) and flip if needed — both sides look ok with thin quads
    let nx = -tz
    let nz = tx
    // Prefer outward from centroid
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
      for (let f = 0; f < floors; f++) {
        salt++
        if (hash01(b.id, salt) > litChance) continue

        const t0 =
          margin / len + ((i + 0.5) / count) * (usable / len) - winWEx / (2 * len)
        const t1 = t0 + winWEx / len
        if (t0 < 0 || t1 > 1) continue

        const y0 = yBase + sillEx + f * floorEx
        const y1 = y0 + winHEx
        if (y1 > yBase + wallHExag - 0.4 * exag) continue

        const x0 = a[0] + dx * t0 + nx * outset
        const z0 = a[1] + dz * t0 + nz * outset
        const x1 = a[0] + dx * t1 + nx * outset
        const z1 = a[1] + dz * t1 + nz * outset

        const base = positions.length / 3
        positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0)
        // CCW when viewed from outside
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
