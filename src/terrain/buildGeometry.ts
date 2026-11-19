import * as THREE from 'three'
import type { ContinuousTerrainJson } from '@shared/tileFormat'
import { lonLatToLocalMeters } from '@shared/geo'

/**
 * Continuous DEM mesh with UVs for landcover texture (V2).
 */
export function continuousTerrainToGeometry(
  terrain: ContinuousTerrainJson,
  verticalExaggeration: number,
  useHypsometric: boolean,
): THREE.BufferGeometry {
  const resX = terrain.resolutionX
  const resZ = terrain.resolutionZ
  const nX = resX + 1
  const nZ = resZ + 1
  const { bbox } = terrain
  const positions = new Float32Array(nX * nZ * 3)
  const colors = new Float32Array(nX * nZ * 3)
  const uvs = new Float32Array(nX * nZ * 2)
  const indices: number[] = []

  for (let row = 0; row < nZ; row++) {
    for (let col = 0; col < nX; col++) {
      const i = row * nX + col
      const u = col / resX
      const v = row / resZ
      const lon = bbox.west + u * (bbox.east - bbox.west)
      const lat = bbox.north + v * (bbox.south - bbox.north)
      const local = lonLatToLocalMeters(
        lon,
        lat,
        terrain.origin.lon,
        terrain.origin.lat,
      )
      const elev = terrain.heights[i]
      const o = i * 3
      positions[o] = local.x
      positions[o + 1] = elev * verticalExaggeration
      positions[o + 2] = local.z

      // UV matches landcover canvas (v grows south with DEM row)
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v

      if (useHypsometric && terrain.colors?.[i]) {
        const hex = terrain.colors[i]
        colors[o] = parseInt(hex.slice(1, 3), 16) / 255
        colors[o + 1] = parseInt(hex.slice(3, 5), 16) / 255
        colors[o + 2] = parseInt(hex.slice(5, 7), 16) / 255
      } else {
        colors[o] = 0.55
        colors[o + 1] = 0.62
        colors[o + 2] = 0.48
      }
    }
  }

  for (let row = 0; row < resZ; row++) {
    for (let col = 0; col < resX; col++) {
      const a = row * nX + col
      const b = a + 1
      const c = a + nX
      const d = c + 1
      indices.push(a, c, b)
      indices.push(b, c, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}
