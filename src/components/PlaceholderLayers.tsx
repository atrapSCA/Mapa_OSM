import { useLayers } from '@/store/layers'

/**
 * Visual stubs so toggles for future OSM layers give immediate feedback
 * while we decide which layers matter for the project.
 */
export function PlaceholderLayers() {
  const water = useLayers((s) => s.water)
  const forests = useLayers((s) => s.forests)
  const buildings = useLayers((s) => s.buildings)
  const roads = useLayers((s) => s.roads)
  const labels = useLayers((s) => s.labels)

  return (
    <group>
      {water && (
        <mesh position={[0, 40, -400]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1800, 120]} />
          <meshStandardMaterial
            color="#7eb8d4"
            transparent
            opacity={0.55}
            flatShading
          />
        </mesh>
      )}
      {forests &&
        Array.from({ length: 40 }).map((_, i) => {
          const x = ((i * 997) % 3000) - 1500
          const z = ((i * 613) % 3000) - 1500
          return (
            <mesh key={i} position={[x, 80, z]}>
              <coneGeometry args={[28, 90, 5]} />
              <meshStandardMaterial color="#2f5c34" flatShading />
            </mesh>
          )
        })}
      {buildings && (
        <mesh position={[200, 60, 100]}>
          <boxGeometry args={[80, 120, 60]} />
          <meshStandardMaterial color="#d8d2c4" flatShading />
        </mesh>
      )}
      {roads && (
        <mesh position={[0, 35, 0]} rotation={[-Math.PI / 2, 0, 0.3]}>
          <planeGeometry args={[4000, 18]} />
          <meshStandardMaterial color="#5a5650" flatShading />
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
