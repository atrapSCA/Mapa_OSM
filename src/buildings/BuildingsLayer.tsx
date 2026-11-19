import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type {
  BuildingLayerJson,
  ContinuousTerrainJson,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { useLayers } from '@/store/layers'
import { useSelection } from '@/store/selection'
import { buildingBaseY, buildingGeometry, geometryMaxY } from './buildingGeom'
import { BuildingBubble } from './BuildingBubble'
import {
  FLAT_DETAIL_COLOR,
  FLAT_PARAPET_COLOR,
} from './flatRoofVariants'
import {
  CHIMNEY_COLOR,
  createRoofGeometry,
  GABLE_WOOD_COLOR,
  gableIsWood,
  roofColorForBuilding,
  roofRiseMeters,
  roofShapeForBuilding,
} from './roofs'
import { facadeColorForBuilding } from './facades'
import { getSkinMaterial, presetForKind } from './skins'
import {
  createWindowGeometry,
  getDarkWindowMaterial,
  getLitWindowMaterial,
} from './windows'

const CLICK_MAX_MOVE_PX = 4

/** Camera distance LOD: 0 near (windows+roof details), ≥1 shells only. */
function useBuildingLod(): 0 | 1 {
  const [lod, setLod] = useState<0 | 1>(1)
  const ref = useRef<0 | 1>(1)
  useFrame(({ camera }) => {
    const d = camera.position.length()
    const cur = ref.current
    // Hysteresis so zooming across the threshold doesn't thrash rebuilds.
    let next: 0 | 1 = cur
    if (cur === 0 && d > 3200) next = 1
    else if (cur === 1 && d < 2600) next = 0
    if (next === cur) return
    ref.current = next
    setLod(next)
  })
  return lod
}

const highlightMat = new THREE.MeshStandardMaterial({
  color: '#f0e6a8',
  emissive: '#6a5a20',
  emissiveIntensity: 0.35,
  flatShading: true,
  roughness: 0.75,
  metalness: 0.05,
})

function ClickMesh({
  buildingId,
  geometry,
  materials,
  selected,
  onSelect,
}: {
  buildingId: string
  geometry: THREE.BufferGeometry
  materials: THREE.Material | THREE.Material[]
  selected: boolean
  onSelect: (id: string) => void
}) {
  const down = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    down.current = { x: e.clientX, y: e.clientY }
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const d = down.current
    down.current = null
    if (d) {
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y)
      if (dist > CLICK_MAX_MOVE_PX) return
    }
    onSelect(buildingId)
  }

  return (
    <mesh
      name={buildingId}
      geometry={geometry}
      material={selected ? highlightMat : materials}
      userData={{ buildingId }}
      frustumCulled
      castShadow={false}
      onPointerDown={onPointerDown}
      onClick={onClick}
    />
  )
}

export function BuildingsLayer({
  buildings,
  terrain,
}: {
  buildings: BuildingLayerJson
  terrain: ContinuousTerrainJson
}) {
  const show = useLayers((s) => s.buildings)
  const skinsOn = useLayers((s) => s.buildingSkins)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  const isKindOn = useLayers((s) => s.isKindOn)
  const exaggeration = useLayers((s) => s.verticalExaggeration)
  const selectedId = useSelection((s) => s.selectedId)
  const select = useSelection((s) => s.select)
  void kindEnabled
  const lod = useBuildingLod()
  const near = lod === 0

  const visible = useMemo(() => {
    return buildings.buildings.filter((b) =>
      isKindOn('buildings', normalizeKind(b.kind)),
    )
  }, [buildings.buildings, isKindOn, kindEnabled])

  /** Walls + simple roofs — stable across zoom; not rebuilt on LOD change. */
  const shells = useMemo(() => {
    const map = new Map<
      string,
      {
        walls: THREE.BufferGeometry
        roof: THREE.BufferGeometry | null
        yBase: number
        yEaves: number
        wallHExag: number
        shape: ReturnType<typeof roofShapeForBuilding>
      }
    >()
    for (const b of visible) {
      const shape = roofShapeForBuilding(b)
      const riseM = roofRiseMeters(b, shape, exaggeration)
      const fullH = Math.max(2.5, Math.min(80, b.height))
      const walls = buildingGeometry(
        b,
        terrain,
        exaggeration,
        fullH,
        true,
      )
      if (!walls) continue

      const yEaves = geometryMaxY(walls) - 0.02
      const yBase = buildingBaseY(b, terrain, exaggeration)
      const roof = createRoofGeometry(
        b.rings[0],
        yEaves,
        shape,
        riseM * exaggeration,
        b,
        exaggeration,
        false,
      )
      map.set(b.id, {
        walls,
        roof,
        yBase,
        yEaves,
        wallHExag: yEaves - yBase,
        shape,
      })
    }
    return map
  }, [visible, terrain, exaggeration])

  /** Windows + detailed roofs only when camera is near. */
  const details = useMemo(() => {
    const map = new Map<
      string,
      {
        roof: THREE.BufferGeometry | null
        windowsDark: THREE.BufferGeometry | null
        windowsLit: THREE.BufferGeometry | null
      }
    >()
    if (!near) return map
    for (const b of visible) {
      const shell = shells.get(b.id)
      if (!shell) continue
      const riseM = roofRiseMeters(b, shell.shape, exaggeration)
      const roof = createRoofGeometry(
        b.rings[0],
        shell.yEaves,
        shell.shape,
        riseM * exaggeration,
        b,
        exaggeration,
        true,
      )
      const wins = createWindowGeometry(
        b,
        shell.yBase,
        shell.wallHExag,
        shell.shape,
      )
      map.set(b.id, {
        roof,
        windowsDark: wins.dark,
        windowsLit: wins.lit,
      })
    }
    return map
  }, [near, visible, shells, exaggeration])

  /** Muted CZ façade colours — shared material per hex. */
  const facadeMaterials = useMemo(() => {
    const map = new Map<string, THREE.MeshStandardMaterial>()
    const get = (color: string) => {
      let m = map.get(color)
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
          roughness: 0.88,
          metalness: 0.04,
        })
        map.set(color, m)
      }
      return m
    }
    for (const b of visible) get(facadeColorForBuilding(b))
    return map
  }, [visible])

  /** CZ red/brown roof tiles — one shared material per colour hex. */
  const roofSlopeMaterials = useMemo(() => {
    const map = new Map<string, THREE.MeshStandardMaterial>()
    const get = (color: string) => {
      let m = map.get(color)
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
          roughness: 0.92,
          metalness: 0.05,
          side: THREE.DoubleSide,
        })
        map.set(color, m)
      }
      return m
    }
    for (const b of visible) get(roofColorForBuilding(b, roofShapeForBuilding(b)))
    return map
  }, [visible])

  const woodGableMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: GABLE_WOOD_COLOR,
        flatShading: true,
        roughness: 0.88,
        metalness: 0.04,
        side: THREE.DoubleSide,
      }),
    [],
  )

  const flatParapetMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: FLAT_PARAPET_COLOR,
        flatShading: true,
        roughness: 0.9,
        metalness: 0.06,
        side: THREE.DoubleSide,
      }),
    [],
  )

  const flatDetailMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: FLAT_DETAIL_COLOR,
        flatShading: true,
        roughness: 0.85,
        metalness: 0.15,
        side: THREE.DoubleSide,
      }),
    [],
  )

  const chimneyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CHIMNEY_COLOR,
        flatShading: true,
        roughness: 0.9,
        metalness: 0.04,
        side: THREE.DoubleSide,
      }),
    [],
  )

  const darkWindowMat = useMemo(() => getDarkWindowMaterial(), [])
  const litWindowMat = useMemo(() => getLitWindowMaterial(), [])

  useEffect(() => {
    return () => {
      for (const p of shells.values()) {
        p.walls.dispose()
        p.roof?.dispose()
      }
    }
  }, [shells])

  useEffect(() => {
    return () => {
      for (const p of details.values()) {
        p.roof?.dispose()
        p.windowsDark?.dispose()
        p.windowsLit?.dispose()
      }
    }
  }, [details])

  useEffect(() => {
    return () => {
      for (const m of facadeMaterials.values()) m.dispose()
      for (const m of roofSlopeMaterials.values()) m.dispose()
      woodGableMat.dispose()
      flatParapetMat.dispose()
      flatDetailMat.dispose()
      chimneyMat.dispose()
    }
  }, [
    facadeMaterials,
    roofSlopeMaterials,
    woodGableMat,
    flatParapetMat,
    flatDetailMat,
    chimneyMat,
  ])

  if (!show) return null

  const selected = selectedId
    ? (visible.find((b) => b.id === selectedId) ?? null)
    : null

  return (
    <group>
      {visible.map((b) => {
        const shell = shells.get(b.id)
        if (!shell) return null
        const detail = details.get(b.id)
        const kind = normalizeKind(b.kind)
        const selected = b.id === selectedId

        const facadeColor = facadeColorForBuilding(b)
        // Flat pastel colour for façades (skin albedo was washing towns to grey).
        // Textured skins only on industrial / garage / farm.
        let wallMat: THREE.Material =
          facadeMaterials.get(facadeColor) ??
          facadeMaterials.values().next().value!
        if (
          skinsOn &&
          (kind === 'industrial' || kind === 'garage' || kind === 'farm')
        ) {
          const preset = presetForKind(kind)
          wallMat = getSkinMaterial(preset.wall, 'wall', facadeColor)
        }

        const shape = shell.shape
        const slopeColor = roofColorForBuilding(b, shape)
        const slopeMat =
          roofSlopeMaterials.get(slopeColor) ??
          roofSlopeMaterials.values().next().value!
        const gableMat = gableIsWood(b) ? woodGableMat : wallMat
        const roofGeom = detail?.roof ?? shell.roof
        const nGroups = roofGeom?.groups.length ?? 0
        let roofMats: THREE.Material | THREE.Material[] = slopeMat
        if (shape === 'flat' && nGroups >= 2) {
          roofMats =
            nGroups >= 3
              ? [slopeMat, flatParapetMat, flatDetailMat]
              : [slopeMat, flatParapetMat]
        } else if (shape === 'gabled' && nGroups >= 3) {
          roofMats = [slopeMat, gableMat, chimneyMat]
        } else if (nGroups === 2) {
          roofMats = [slopeMat, gableMat]
        }

        return (
          <group key={b.id}>
            <ClickMesh
              buildingId={b.id}
              geometry={shell.walls}
              materials={wallMat}
              selected={selected}
              onSelect={select}
            />
            {roofGeom && (
              <ClickMesh
                buildingId={b.id}
                geometry={roofGeom}
                materials={roofMats}
                selected={selected}
                onSelect={select}
              />
            )}
            {detail?.windowsDark && (
              <mesh
                geometry={detail.windowsDark}
                material={darkWindowMat}
                frustumCulled
                castShadow={false}
                renderOrder={2}
              />
            )}
            {detail?.windowsLit && (
              <mesh
                geometry={detail.windowsLit}
                material={litWindowMat}
                frustumCulled
                castShadow={false}
                renderOrder={2}
              />
            )}
          </group>
        )
      })}
      {selected && (
        <BuildingBubble
          building={selected}
          terrain={terrain}
          exaggeration={exaggeration}
        />
      )}
    </group>
  )
}
