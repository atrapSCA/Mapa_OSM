import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Sky, Grid } from '@react-three/drei'
import type { LoadedRegion } from '@/hooks/useRegionManifest'
import { TerrainMesh } from '@/terrain/TerrainTiles'
import { WaterLayer } from '@/water/WaterLayer'
import { RoadsLayer } from '@/roads/RoadsLayer'
import { BuildingsLayer } from '@/buildings/BuildingsLayer'
import { useLayers } from '@/store/layers'
import { useSelection } from '@/store/selection'
import { PlaceholderLayers } from './PlaceholderLayers'

/** Clear selection on background click (terrain/roads), ignore camera drags. */
function SelectionClickGuard() {
  const { gl, camera, scene } = useThree()
  const clear = useSelection((s) => s.clear)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const pointer = useMemo(() => new THREE.Vector2(), [])

  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      down = { x: e.clientX, y: e.clientY }
    }

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 4) return

      const rect = el.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(scene.children, true)
      const hitBuilding = hits.some((h) => h.object.userData?.buildingId)
      if (!hitBuilding) clear()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [gl, camera, scene, clear, raycaster, pointer])

  return null
}

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
        position: [9000, midElev + 7500, 11000],
        fov: 48,
        near: 1,
        far: 120000,
      }}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
    >
      <color attach="background" args={['#8fb0a8']} />
      <fog attach="fog" args={['#a8c0b4', 12000, 45000]} />
      <Sky
        distance={450000}
        sunPosition={[1, 0.35, 0.2]}
        inclination={0.48}
        azimuth={0.25}
        mieCoefficient={0.004}
        rayleigh={0.6}
      />
      <SelectionClickGuard />
      <Lights />
      <Helpers />
      <TerrainMesh
        terrain={region.terrain}
        nature={region.nature}
        water={region.water}
      />
      {region.water && (
        <WaterLayer water={region.water} terrain={region.terrain} />
      )}
      {region.roads && (
        <RoadsLayer roads={region.roads} terrain={region.terrain} />
      )}
      {region.buildings && (
        <BuildingsLayer
          buildings={region.buildings}
          terrain={region.terrain}
        />
      )}
      <PlaceholderLayers />
      <OrbitControls
        target={[0, midElev * 0.4, 0]}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={400}
        maxDistance={42000}
        enableDamping
      />
    </Canvas>
  )
}
