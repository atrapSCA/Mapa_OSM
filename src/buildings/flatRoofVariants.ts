import type { Building } from '@shared/tileFormat'

/** 10 procedural flat-roof layouts inspired by CZ panelák / hall satellite views. */
export type FlatRoofVariant = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export const FLAT_PARAPET_COLOR = '#9a9a9a'
export const FLAT_DETAIL_COLOR = '#3a3a3a'
export const FLAT_SOLAR_COLOR = '#1a2430'

function hash01(id: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export function flatRoofVariantForBuilding(b: Building): FlatRoofVariant {
  return Math.floor(hash01(b.id, 91) * 10) as FlatRoofVariant
}

type OBB = {
  ux: number
  uz: number
  vx: number
  vz: number
  halfU: number
  halfV: number
  cx: number
  cz: number
}

function pushTri(
  indices: number[],
  i0: number,
  i1: number,
  i2: number,
): void {
  indices.push(i0, i1, i2)
}

/** Axis-aligned box in XZ with Y up; material group via separate index buffers. */
function addBox(
  indices: number[],
  push: (x: number, y: number, z: number) => number,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  halfU: number,
  halfV: number,
  ux: number,
  uz: number,
  vx: number,
  vz: number,
): void {
  const c = (du: number, dv: number, y: number) =>
    push(cx + du * ux + dv * vx, y, cz + du * uz + dv * vz)
  const b000 = c(-halfU, -halfV, y0)
  const b100 = c(halfU, -halfV, y0)
  const b110 = c(halfU, halfV, y0)
  const b010 = c(-halfU, halfV, y0)
  const t000 = c(-halfU, -halfV, y1)
  const t100 = c(halfU, -halfV, y1)
  const t110 = c(halfU, halfV, y1)
  const t010 = c(-halfU, halfV, y1)
  // top
  pushTri(indices, t000, t100, t110)
  pushTri(indices, t000, t110, t010)
  // sides
  pushTri(indices, b000, b100, t100)
  pushTri(indices, b000, t100, t000)
  pushTri(indices, b100, b110, t110)
  pushTri(indices, b100, t110, t100)
  pushTri(indices, b110, b010, t010)
  pushTri(indices, b110, t010, t110)
  pushTri(indices, b010, b000, t000)
  pushTri(indices, b010, t000, t010)
}

function addParapet(
  ring: [number, number][],
  yDeck: number,
  indices: number[],
  push: (x: number, y: number, z: number) => number,
  height: number,
  thickness: number,
): void {
  const y1 = yDeck + height
  const n = ring.length
  // Inward offset approximate via edge normals
  let cx = 0
  let cz = 0
  for (const p of ring) {
    cx += p[0]
    cz += p[1]
  }
  cx /= n
  cz /= n

  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < 0.4) continue
    const tx = dx / len
    const tz = dz / len
    let nx = -tz
    let nz = tx
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    if ((mx - cx) * nx + (mz - cz) * nz > 0) {
      nx = -nx
      nz = -nz
    }
    // outward normal for parapet sitting on edge
    const ox = -nx
    const oz = -nz
    const inset = thickness
    const ax0 = a[0] + ox * 0.02
    const az0 = a[1] + oz * 0.02
    const bx0 = b[0] + ox * 0.02
    const bz0 = b[1] + oz * 0.02
    const ax1 = a[0] + nx * inset
    const az1 = a[1] + nz * inset
    const bx1 = b[0] + nx * inset
    const bz1 = b[1] + nz * inset

    const i0 = push(ax0, yDeck, az0)
    const i1 = push(bx0, yDeck, bz0)
    const i2 = push(bx0, y1, bz0)
    const i3 = push(ax0, y1, az0)
    const i4 = push(ax1, yDeck, az1)
    const i5 = push(bx1, yDeck, bz1)
    const i6 = push(bx1, y1, bz1)
    const i7 = push(ax1, y1, az1)
    // outer face
    pushTri(indices, i0, i1, i2)
    pushTri(indices, i0, i2, i3)
    // inner face
    pushTri(indices, i5, i4, i7)
    pushTri(indices, i5, i7, i6)
    // top
    pushTri(indices, i3, i2, i6)
    pushTri(indices, i3, i6, i7)
    void tx
  }
}

/**
 * Append parapet + clutter for a flat roof variant.
 * Writes into parapetIndices / detailIndices (separate material groups).
 */
export function appendFlatRoofDetails(
  variant: FlatRoofVariant,
  ring: [number, number][],
  obb: OBB,
  yDeck: number,
  exag: number,
  push: (x: number, y: number, z: number) => number,
  parapetIndices: number[],
  detailIndices: number[],
): void {
  const hParapet = 0.45 * Math.min(exag, 2.5)
  addParapet(ring, yDeck, parapetIndices, push, hParapet, 0.28)

  const { cx, cz, ux, uz, vx, vz, halfU, halfV } = obb
  const long = Math.max(halfU, halfV)
  const short = Math.min(halfU, halfV)
  if (long < 3 || short < 1.2) return

  const alongU = halfU >= halfV
  const ru = alongU ? ux : vx
  const rz = alongU ? uz : vz
  const su = alongU ? vx : ux
  const sz = alongU ? vz : uz
  const halfLong = long
  const halfShort = short

  const y0 = yDeck + 0.02
  const box = (
    indices: number[],
    u: number,
    v: number,
    hu: number,
    hv: number,
    h: number,
  ) => {
    const x = cx + u * ru + v * su
    const z = cz + u * rz + v * sz
    addBox(indices, push, x, z, y0, y0 + h, hu, hv, ru, rz, su, sz)
  }

  const ventH = 0.55 * Math.min(exag, 2.2)
  const hvacH = 1.1 * Math.min(exag, 2.2)
  const roomH = 1.6 * Math.min(exag, 2.2)
  const solarH = 0.22 * Math.min(exag, 2.2)

  const placeVentRow = (count: number, vOff: number, indices: number[]) => {
    const span = halfLong * 1.5
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2
      const u = t * span * 0.42
      box(indices, u, vOff, 0.35, 0.35, ventH)
    }
  }

  switch (variant) {
    case 0: // bare + parapet only
      break
    case 1: // center vent row
      placeVentRow(Math.max(3, Math.floor(halfLong / 3)), 0, detailIndices)
      break
    case 2: // sparse vents
      placeVentRow(Math.max(2, Math.floor(halfLong / 5)), halfShort * 0.15, detailIndices)
      placeVentRow(2, -halfShort * 0.25, detailIndices)
      break
    case 3: // HVAC cluster near center
      box(detailIndices, 0, 0, 1.2, 0.9, hvacH)
      box(detailIndices, halfLong * 0.25, halfShort * 0.1, 0.7, 0.55, hvacH * 0.85)
      box(detailIndices, -halfLong * 0.2, -halfShort * 0.15, 0.5, 0.5, ventH)
      break
    case 4: // elevator / stair rooms along one long edge
      {
        const n = Math.max(2, Math.min(5, Math.floor(halfLong / 4)))
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2
          box(
            detailIndices,
            t * halfLong * 0.7,
            halfShort * 0.55,
            1.4,
            1.0,
            roomH,
          )
        }
      }
      break
    case 5: // solar strip
      box(
        detailIndices,
        0,
        -halfShort * 0.35,
        halfLong * 0.75,
        halfShort * 0.28,
        solarH,
      )
      break
    case 6: // vents + solar
      placeVentRow(Math.max(3, Math.floor(halfLong / 4)), halfShort * 0.2, detailIndices)
      box(
        detailIndices,
        0,
        -halfShort * 0.4,
        halfLong * 0.7,
        halfShort * 0.22,
        solarH,
      )
      break
    case 7: // seam blocks + vents (grid feel)
      {
        const cols = Math.max(2, Math.min(4, Math.floor(halfLong / 5)))
        const rows = 2
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const u = (c / Math.max(cols - 1, 1) - 0.5) * halfLong * 1.2
            const v = (r - 0.5) * halfShort * 0.5
            box(detailIndices, u, v, 0.3, 0.3, ventH * 0.8)
          }
        }
        // thin ridge seam as long low box
        box(detailIndices, 0, 0, halfLong * 0.85, 0.08, 0.12 * exag)
      }
      break
    case 8: // large hatches + antenna stub
      box(detailIndices, -halfLong * 0.25, halfShort * 0.1, 1.1, 1.1, roomH * 0.7)
      box(detailIndices, halfLong * 0.3, halfShort * 0.05, 1.0, 1.0, roomH * 0.65)
      box(detailIndices, halfLong * 0.55, -halfShort * 0.2, 0.15, 0.15, 2.2 * Math.min(exag, 2))
      break
    case 9: // dense tech
      placeVentRow(Math.max(4, Math.floor(halfLong / 2.8)), 0, detailIndices)
      box(detailIndices, halfLong * 0.15, halfShort * 0.35, 1.3, 0.9, hvacH)
      box(detailIndices, -halfLong * 0.35, -halfShort * 0.3, 0.8, 0.7, hvacH * 0.9)
      box(
        detailIndices,
        0,
        -halfShort * 0.45,
        halfLong * 0.55,
        halfShort * 0.18,
        solarH,
      )
      break
  }
}
