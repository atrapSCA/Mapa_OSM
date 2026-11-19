import { Canvas } from '@react-three/fiber'
import { OrbitControls, Sky, Grid } from '@react-three/drei'
import type { LoadedRegion } from '@/hooks/useRegionManifest'
import { TerrainMesh } from '@/terrain/TerrainTiles'
import { NatureLayer } from '@/nature/NatureLayer'
import { WaterLayer } from '@/water/WaterLayer'
import { RoadsLayer } from '@/roads/RoadsLayer'
import { useLayers } from '@/store/layers'
import { PlaceholderLayers } from './PlaceholderLayers'

function Lights() {
  const soft = useLayers((s) => s.softLight)
  return (
    <>
      <ambientLight intensity={soft ? 0.55 : 0.25} />
      <hemisphereLight
        color="#dce9f2"
        groundColor="#6b7a52"
        intensity={soft ? 0.65 : 0.2}
      />
      <directionalLight
        position={[4200, 6800, 1800]}
        intensity={soft ? 1.15 : 1.6}
        castShadow={false}
      />
    </>
  )
}

function Helpers() {
  const grid = useLayers((s) => s.grid)
  if (!grid) return null
  return (
    <Grid
      args={[12000, 12000]}
      cellSize={200}
      sectionSize={1000}
      cellColor="#4a5c52"
      sectionColor="#6a8074"
      fadeDistance={9000}
      position={[0, 0, 0]}
    />
  )
}

export function Scene({ region }: { region: LoadedRegion }) {
  const midElev =
    ((region.manifest.stats.minElev + region.manifest.stats.maxElev) / 2) *
    region.manifest.verticalExaggeration

  return (
    <Canvas
      camera={{
        position: [4200, midElev + 3800, 5200],
        fov: 48,
        near: 1,
        far: 80000,
      }}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
    >
      <color attach="background" args={['#8fb0a8']} />
      <fog attach="fog" args={['#a8c0b4', 6000, 22000]} />
      <Sky
        distance={450000}
        sunPosition={[1, 0.35, 0.2]}
        inclination={0.48}
        azimuth={0.25}
        mieCoefficient={0.004}
        rayleigh={0.6}
      />
      <Lights />
      <Helpers />
      <TerrainMesh terrain={region.terrain} />
      {region.nature && (
        <NatureLayer nature={region.nature} terrain={region.terrain} />
      )}
      {region.water && (
        <WaterLayer water={region.water} terrain={region.terrain} />
      )}
      {region.roads && (
        <RoadsLayer roads={region.roads} terrain={region.terrain} />
      )}
      <PlaceholderLayers />
      <OrbitControls
        target={[0, midElev * 0.4, 0]}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={400}
        maxDistance={18000}
        enableDamping
      />
    </Canvas>
  )
}
