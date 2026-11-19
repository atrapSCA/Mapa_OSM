/**
 * On-disk tile format — designed so the same files work for one region or the planet.
 *
 * Layout:
 *   data/tiles/{region}/manifest.json
 *   data/tiles/{region}/terrain/{z}/{x}/{y}.json
 *
 * Later: swap JSON for glTF/binary for world-scale bandwidth.
 */

export type TerrainTileJson = {
  format: 'mapa-osm-terrain-v1'
  z: number
  x: number
  y: number
  /** Vertex grid size (resolution + 1). */
  resolution: number
  /** Local meters: origin = region center. */
  origin: { lon: number; lat: number }
  boundsLocal: {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
  }
  /** Row-major elevations in meters, length = (resolution+1)^2 */
  heights: number[]
  /** Optional precomputed face/vertex colors as #rrggbb — length heights or faces. */
  colors?: string[]
  minElev: number
  maxElev: number
}

/** Seamless mesh for a small region (no tile-edge squares). */
export type ContinuousTerrainJson = {
  format: 'mapa-osm-terrain-continuous-v1'
  /** Cells along west→east (vertex count = resolutionX + 1). */
  resolutionX: number
  /** Cells along north→south. */
  resolutionZ: number
  origin: { lon: number; lat: number }
  bbox: {
    west: number
    south: number
    east: number
    north: number
  }
  boundsLocal: {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
  }
  /** Row-major north→south, west→east; length = (resZ+1)*(resX+1) */
  heights: number[]
  colors?: string[]
  minElev: number
  maxElev: number
}

export type RegionManifest = {
  format: 'mapa-osm-manifest-v1'
  regionId: string
  name: string
  center: { lon: number; lat: number }
  bbox: {
    west: number
    south: number
    east: number
    north: number
  }
  zoom: number
  meshResolution: number
  verticalExaggeration: number
  /** Preferred seamless mesh for local regions. */
  continuousPath?: string
  tiles: { z: number; x: number; y: number; path: string }[]
  generatedAt: string
  stats: {
    tileCount: number
    minElev: number
    maxElev: number
    grid?: string
  }
}
