/** Slippy-map / Web Mercator helpers — same tile scheme works from 10 km to planet. */

export type BBox = {
  west: number
  south: number
  east: number
  north: number
}

export type TileCoord = { z: number; x: number; y: number }

/** Square bbox centered on lon/lat, size in meters (approx). */
export function bboxFromCenter(
  lon: number,
  lat: number,
  sizeMeters: number,
): BBox {
  const half = sizeMeters / 2
  const mPerDegLat = 111_320
  const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180)
  const dLat = half / mPerDegLat
  const dLon = half / mPerDegLon
  return {
    west: lon - dLon,
    south: lat - dLat,
    east: lon + dLon,
    north: lat + dLat,
  }
}

export function lonLatToTile(lon: number, lat: number, z: number): TileCoord {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return { z, x, y }
}

export function tileToBBox(z: number, x: number, y: number): BBox {
  const n = 2 ** z
  const west = (x / n) * 360 - 180
  const east = ((x + 1) / n) * 360 - 180
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI
  return { west, south, east, north }
}

export function tilesCoveringBBox(bbox: BBox, z: number): TileCoord[] {
  const nw = lonLatToTile(bbox.west, bbox.north, z)
  const se = lonLatToTile(bbox.east, bbox.south, z)
  const tiles: TileCoord[] = []
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) {
      tiles.push({ z, x, y })
    }
  }
  return tiles
}

/** Local ENU-ish meters relative to origin (flat earth for small regions). */
export function lonLatToLocalMeters(
  lon: number,
  lat: number,
  originLon: number,
  originLat: number,
): { x: number; z: number } {
  const mPerDegLat = 111_320
  const mPerDegLon = 111_320 * Math.cos((originLat * Math.PI) / 180)
  return {
    x: (lon - originLon) * mPerDegLon,
    z: -(lat - originLat) * mPerDegLat,
  }
}

export const REGIONS = {
  rakovnik: {
    id: 'rakovnik',
    name: 'Rakovník 10×10 km',
    center: { lon: 13.7333, lat: 50.1042 },
    sizeMeters: 10_000,
    /** Terrain tile zoom — ~2–3 km/tile at lat 50. */
    zoom: 13,
    /** Continuous mesh cells across the region (~30 m; nature subdivides further). */
    meshResolution: 320,
    verticalExaggeration: 2.2,
  },
} as const

export type RegionId = keyof typeof REGIONS
