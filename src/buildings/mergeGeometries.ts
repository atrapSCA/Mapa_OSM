import * as THREE from 'three'

/** Merge BufferGeometries that share the same material (positions + index + optional uv). */
export function mergeGeometries(
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry | null {
  if (geos.length === 0) return null
  if (geos.length === 1) return geos[0].clone()

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let hasUv = true
  let vertexOffset = 0

  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos || pos.count === 0) continue
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined
    if (!uv) hasUv = false

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      if (hasUv && uv) uvs.push(uv.getX(i), uv.getY(i))
    }

    const idx = g.getIndex()
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset)
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(vertexOffset + i)
      }
    }
    vertexOffset += pos.count
  }

  if (positions.length === 0 || indices.length < 3) return null

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (hasUv && uvs.length === (positions.length / 3) * 2) {
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  }
  out.setIndex(indices)
  out.computeVertexNormals()
  return out
}

/**
 * Extract triangles that belong to `materialIndex` into a new geometry.
 * Returns null when the group is empty.
 */
export function extractMaterialGroup(
  geo: THREE.BufferGeometry,
  materialIndex: number,
): THREE.BufferGeometry | null {
  const groups = geo.groups.filter((g) => g.materialIndex === materialIndex)
  if (groups.length === 0) {
    // No groups → whole mesh is material 0
    if (materialIndex === 0) return geo.clone()
    return null
  }

  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined
  const idx = geo.getIndex()
  if (!pos || !idx) return null

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const remap = new Map<number, number>()

  const addVertex = (vi: number) => {
    let ni = remap.get(vi)
    if (ni != null) return ni
    ni = positions.length / 3
    remap.set(vi, ni)
    positions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
    if (uv) uvs.push(uv.getX(vi), uv.getY(vi))
    return ni
  }

  for (const g of groups) {
    for (let i = g.start; i < g.start + g.count; i++) {
      indices.push(addVertex(idx.getX(i)))
    }
  }

  if (indices.length < 3) return null
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (uv && uvs.length === (positions.length / 3) * 2) {
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  }
  out.setIndex(indices)
  out.computeVertexNormals()
  return out
}
