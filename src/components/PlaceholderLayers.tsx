import { useLayers } from '@/store/layers'

/**
 * Visual stubs for layers not yet wired to OSM data.
 */
export function PlaceholderLayers() {
  const buildings = useLayers((s) => s.buildings)
  const labels = useLayers((s) => s.labels)

  return (
    <group>
      {buildings && (
        <mesh position={[200, 60, 100]}>
          <boxGeometry args={[80, 120, 60]} />
          <meshStandardMaterial color="#d8d2c4" flatShading />
        </mesh>
      )}
      {labels && (
        <mesh position={[0, 520, 0]}>
          <sphereGeometry args={[40, 8, 6]} />
          <meshStandardMaterial color="#e07a3a" flatShading />
        </mesh>
      )}
    </group>
  )
}
