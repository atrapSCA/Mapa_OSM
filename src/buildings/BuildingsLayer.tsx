import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type {
  BuildingLayerJson,
  ContinuousTerrainJson,
} from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'
import { pointInPolygon, ringsBBox } from '@/geo/pointInPolygon'
import { useLayers } from '@/store/layers'
import { useSelection } from '@/store/selection'
import { buildingBaseY, buildingGeometry, geometryMaxY } from './buildingGeom'
import { BuildingBubble } from './BuildingBubble'
import { extractMaterialGroup, mergeGeometries } from './mergeGeometries'
import {
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
/** Windows only inside this radius of camera XZ when zoomed in. */
const DETAIL_RADIUS_M = 900
const DETAIL_RADIUS2 = DETAIL_RADIUS_M * DETAIL_RADIUS_M

type PickRec = {
  id: string
  rings: [number, number][][]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cx: number
  cz: number
}

type LodFocus = {
  near: boolean
  x: number
  z: number
}

/** Camera distance + XZ focus for local window LOD. */
function useBuildingLodFocus(): LodFocus {
  const [focus, setFocus] = useState<LodFocus>({ near: false, x: 0, z: 0 })
  const ref = useRef<LodFocus>({ near: false, x: 0, z: 0 })
  useFrame(({ camera }) => {
    const d = camera.position.length()
    const cur = ref.current
    let near = cur.near
    if (cur.near && d > 3200) near = false
    else if (!cur.near && d < 2600) near = true

    const x = camera.position.x
    const z = camera.position.z
    const moved = Math.hypot(x - cur.x, z - cur.z)
    // Rebuild window batches only when focus jumps or near flips.
    if (near === cur.near && (!near || moved < 220)) return
    const next = { near, x, z }
    ref.current = next
    setFocus(next)
  })
  return focus
}

function pickBuildingId(x: number, z: number, picks: PickRec[]): string | null {
  let best: PickRec | null = null
  let bestD = Infinity
  for (const p of picks) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue
    if (!pointInPolygon(x, z, p.rings)) continue
    const d = (x - p.cx) * (x - p.cx) + (z - p.cz) * (z - p.cz)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best?.id ?? null
}

const highlightMat = new THREE.MeshStandardMaterial({
  color: '#f0e6a8',
  emissive: '#6a5a20',
  emissiveIntensity: 0.35,
  flatShading: true,
  roughness: 0.75,
  metalness: 0.05,
})

function BatchMesh({
  geometry,
  material,
  onPick,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  onPick: (x: number, z: number) => void
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
    onPick(e.point.x, e.point.z)
  }

  return (
    <mesh
      geometry={geometry}
      material={material}
      userData={{ buildingId: '__batch__' }}
      frustumCulled
      castShadow={false}
      onPointerDown={onPointerDown}
      onClick={onClick}
    />
  )
}

function pushBatch(
  map: Map<string, THREE.BufferGeometry[]>,
  key: string,
  geo: THREE.BufferGeometry | null,
) {
  if (!geo) return
  let arr = map.get(key)
  if (!arr) {
    arr = []
    map.set(key, arr)
  }
  arr.push(geo)
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
  const focus = useBuildingLodFocus()

  const visible = useMemo(() => {
    return buildings.buildings.filter((b) =>
      isKindOn('buildings', normalizeKind(b.kind)),
    )
  }, [buildings.buildings, isKindOn, kindEnabled])

  const pickIndex = useMemo((): PickRec[] => {
    const out: PickRec[] = []
    for (const b of visible) {
      const rings = b.rings
      if (!rings?.[0] || rings[0].length < 3) continue
      const { minX, maxX, minZ, maxZ } = ringsBBox(rings)
      let cx = 0
      let cz = 0
      const ring = rings[0]
      const n =
        ring.length > 1 &&
        ring[0][0] === ring[ring.length - 1][0] &&
        ring[0][1] === ring[ring.length - 1][1]
          ? ring.length - 1
          : ring.length
      for (let i = 0; i < n; i++) {
        cx += ring[i][0]
        cz += ring[i][1]
      }
      cx /= Math.max(1, n)
      cz /= Math.max(1, n)
      out.push({ id: b.id, rings, minX, maxX, minZ, maxZ, cx, cz })
    }
    return out
  }, [visible])

  const pickById = useMemo(() => {
    const m = new Map<string, PickRec>()
    for (const p of pickIndex) m.set(p.id, p)
    return m
  }, [pickIndex])

  /** Batched wall/roof meshes — stable across zoom. */
  const batches = useMemo(() => {
    const wallParts = new Map<string, THREE.BufferGeometry[]>()
    const roofSlopeParts = new Map<string, THREE.BufferGeometry[]>()
    const roofGableParts = new Map<string, THREE.BufferGeometry[]>()
    const skinWalls: {
      id: string
      geo: THREE.BufferGeometry
      mat: THREE.Material
    }[] = []
    const meta = new Map<
      string,
      { yBase: number; yEaves: number; wallHExag: number; shape: string }
    >()

    for (const b of visible) {
      const kind = normalizeKind(b.kind)
      const shape = roofShapeForBuilding(b)
      const riseM = roofRiseMeters(b, shape, exaggeration)
      const fullH = Math.max(2.5, Math.min(80, b.height))
      const walls = buildingGeometry(b, terrain, exaggeration, fullH, true)
      if (!walls) continue

      const yEaves = geometryMaxY(walls) - 0.02
      const yBase = buildingBaseY(b, terrain, exaggeration)
      meta.set(b.id, {
        yBase,
        yEaves,
        wallHExag: yEaves - yBase,
        shape,
      })

      const facadeColor = facadeColorForBuilding(b)
      const useSkin =
        skinsOn &&
        (kind === 'industrial' || kind === 'garage' || kind === 'farm')

      if (useSkin) {
        const preset = presetForKind(kind)
        skinWalls.push({
          id: b.id,
          geo: walls,
          mat: getSkinMaterial(preset.wall, 'wall', facadeColor),
        })
      } else {
        pushBatch(wallParts, facadeColor, walls)
      }

      const roof = createRoofGeometry(
        b.rings[0],
        yEaves,
        shape,
        riseM * exaggeration,
        b,
        exaggeration,
        false,
      )
      if (roof) {
        const slopeColor = roofColorForBuilding(b, shape)
        const slope = extractMaterialGroup(roof, 0)
        pushBatch(roofSlopeParts, slopeColor, slope)

        if ((roof.groups?.length ?? 0) >= 2) {
          const gable = extractMaterialGroup(roof, 1)
          const gableKey = gableIsWood(b) ? '__wood__' : facadeColor
          pushBatch(roofGableParts, gableKey, gable)
        }
        roof.dispose()
      }
    }

    const wallMerged = new Map<string, THREE.BufferGeometry>()
    for (const [k, parts] of wallParts) {
      const m = mergeGeometries(parts)
      for (const p of parts) p.dispose()
      if (m) wallMerged.set(k, m)
    }

    const slopeMerged = new Map<string, THREE.BufferGeometry>()
    for (const [k, parts] of roofSlopeParts) {
      const m = mergeGeometries(parts)
      for (const p of parts) p.dispose()
      if (m) slopeMerged.set(k, m)
    }

    const gableMerged = new Map<string, THREE.BufferGeometry>()
    for (const [k, parts] of roofGableParts) {
      const m = mergeGeometries(parts)
      for (const p of parts) p.dispose()
      if (m) gableMerged.set(k, m)
    }

    return { wallMerged, slopeMerged, gableMerged, skinWalls, meta }
  }, [visible, terrain, exaggeration, skinsOn])

  /** Windows only near camera focus — two merged meshes. */
  const windowBatches = useMemo(() => {
    if (!focus.near) {
      return {
        dark: null as THREE.BufferGeometry | null,
        lit: null as THREE.BufferGeometry | null,
      }
    }
    const darkParts: THREE.BufferGeometry[] = []
    const litParts: THREE.BufferGeometry[] = []
    for (const b of visible) {
      const pick = pickById.get(b.id)
      const meta = batches.meta.get(b.id)
      if (!pick || !meta) continue
      const dx = pick.cx - focus.x
      const dz = pick.cz - focus.z
      if (dx * dx + dz * dz > DETAIL_RADIUS2) continue
      const wins = createWindowGeometry(
        b,
        meta.yBase,
        meta.wallHExag,
        meta.shape as ReturnType<typeof roofShapeForBuilding>,
      )
      if (wins.dark) darkParts.push(wins.dark)
      if (wins.lit) litParts.push(wins.lit)
    }
    const dark = mergeGeometries(darkParts)
    const lit = mergeGeometries(litParts)
    for (const g of darkParts) g.dispose()
    for (const g of litParts) g.dispose()
    return { dark, lit }
  }, [focus, visible, pickById, batches.meta])

  /** Selected building overlay (single mesh pair). */
  const selectionGeos = useMemo(() => {
    if (!selectedId) return null
    const b = visible.find((x) => x.id === selectedId)
    if (!b) return null
    const shape = roofShapeForBuilding(b)
    const riseM = roofRiseMeters(b, shape, exaggeration)
    const fullH = Math.max(2.5, Math.min(80, b.height))
    const walls = buildingGeometry(b, terrain, exaggeration, fullH, true)
    if (!walls) return null
    const yEaves = geometryMaxY(walls) - 0.02
    const roof = createRoofGeometry(
      b.rings[0],
      yEaves,
      shape,
      riseM * exaggeration,
      b,
      exaggeration,
      false,
    )
    return { walls, roof }
  }, [selectedId, visible, terrain, exaggeration])

  const facadeMaterials = useMemo(() => {
    const map = new Map<string, THREE.MeshStandardMaterial>()
    for (const color of batches.wallMerged.keys()) {
      map.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
          roughness: 0.94,
          metalness: 0.02,
          side: THREE.DoubleSide,
        }),
      )
    }
    for (const color of batches.gableMerged.keys()) {
      if (color === '__wood__' || map.has(color)) continue
      map.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
          roughness: 0.94,
          metalness: 0.02,
          side: THREE.DoubleSide,
        }),
      )
    }
    return map
  }, [batches.wallMerged, batches.gableMerged])

  const roofSlopeMaterials = useMemo(() => {
    const map = new Map<string, THREE.MeshStandardMaterial>()
    for (const color of batches.slopeMerged.keys()) {
      map.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
          roughness: 0.92,
          metalness: 0.05,
          side: THREE.DoubleSide,
        }),
      )
    }
    return map
  }, [batches.slopeMerged])

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

  const darkWindowMat = useMemo(() => getDarkWindowMaterial(), [])
  const litWindowMat = useMemo(() => getLitWindowMaterial(), [])

  useEffect(() => {
    return () => {
      for (const g of batches.wallMerged.values()) g.dispose()
      for (const g of batches.slopeMerged.values()) g.dispose()
      for (const g of batches.gableMerged.values()) g.dispose()
      for (const s of batches.skinWalls) s.geo.dispose()
    }
  }, [batches])

  useEffect(() => {
    return () => {
      windowBatches.dark?.dispose()
      windowBatches.lit?.dispose()
    }
  }, [windowBatches])

  useEffect(() => {
    return () => {
      selectionGeos?.walls.dispose()
      selectionGeos?.roof?.dispose()
    }
  }, [selectionGeos])

  useEffect(() => {
    return () => {
      for (const m of facadeMaterials.values()) m.dispose()
      for (const m of roofSlopeMaterials.values()) m.dispose()
      woodGableMat.dispose()
    }
  }, [facadeMaterials, roofSlopeMaterials, woodGableMat])

  if (!show) return null

  const selected = selectedId
    ? (visible.find((b) => b.id === selectedId) ?? null)
    : null

  const onPick = (x: number, z: number) => {
    const id = pickBuildingId(x, z, pickIndex)
    if (id) select(id)
  }

  return (
    <group>
      {[...batches.wallMerged.entries()].map(([color, geo]) => (
        <BatchMesh
          key={`w-${color}`}
          geometry={geo}
          material={facadeMaterials.get(color)!}
          onPick={onPick}
        />
      ))}
      {batches.skinWalls.map((s) => (
        <BatchMesh
          key={`sw-${s.id}`}
          geometry={s.geo}
          material={s.mat}
          onPick={onPick}
        />
      ))}
      {[...batches.slopeMerged.entries()].map(([color, geo]) => (
        <BatchMesh
          key={`rs-${color}`}
          geometry={geo}
          material={roofSlopeMaterials.get(color)!}
          onPick={onPick}
        />
      ))}
      {[...batches.gableMerged.entries()].map(([key, geo]) => {
        const mat =
          key === '__wood__'
            ? woodGableMat
            : (facadeMaterials.get(key) ?? woodGableMat)
        return (
          <BatchMesh
            key={`rg-${key}`}
            geometry={geo}
            material={mat}
            onPick={onPick}
          />
        )
      })}
      {windowBatches.dark && (
        <mesh
          geometry={windowBatches.dark}
          material={darkWindowMat}
          frustumCulled
          castShadow={false}
          renderOrder={2}
        />
      )}
      {windowBatches.lit && (
        <mesh
          geometry={windowBatches.lit}
          material={litWindowMat}
          frustumCulled
          castShadow={false}
          renderOrder={2}
        />
      )}
      {selectionGeos && (
        <mesh
          geometry={selectionGeos.walls}
          material={highlightMat}
          frustumCulled
          castShadow={false}
          renderOrder={3}
        />
      )}
      {selectionGeos?.roof && (
        <mesh
          geometry={selectionGeos.roof}
          material={highlightMat}
          frustumCulled
          castShadow={false}
          renderOrder={3}
        />
      )}
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
