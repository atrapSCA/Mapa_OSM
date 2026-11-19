import { useLayers } from '@/store/layers'

/**
 * Visual stubs for layers not yet wired to OSM data.
 */
export function PlaceholderLayers() {
  const labels = useLayers((s) => s.labels)

  if (!labels) return null

  return (
    <mesh position={[0, 520, 0]}>
      <sphereGeometry args={[40, 8, 6]} />
      <meshStandardMaterial color="#e07a3a" flatShading />
    </mesh>
  )
}
