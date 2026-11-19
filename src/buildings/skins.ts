import * as THREE from 'three'
import { normalizeKind } from '@shared/osmLabels'

export type SkinDef = {
  id: string
  /** Path under public/ */
  url: string
  /** Real-world tile width in metres (OSM Texture Library). */
  tileWidthM: number
  /** Real-world tile height in metres. */
  tileHeightM: number
}

export type KindSkinPreset = {
  wall: string
  roof: string
}

/** Catalog of vendored OSM Texture Library skins. */
export const SKINS: Record<string, SkinDef> = {
  brick: {
    id: 'brick',
    url: '/textures/buildings/brick.jpg',
    tileWidthM: 0.8,
    tileHeightM: 0.8,
  },
  plaster: {
    id: 'plaster',
    url: '/textures/buildings/plaster.jpg',
    tileWidthM: 1.0,
    tileHeightM: 1.0,
  },
  stone: {
    id: 'stone',
    url: '/textures/buildings/stone.jpg',
    tileWidthM: 1.2,
    tileHeightM: 0.6,
  },
  metal: {
    id: 'metal',
    url: '/textures/buildings/metal.jpg',
    tileWidthM: 2.0,
    tileHeightM: 2.0,
  },
  wood: {
    id: 'wood',
    url: '/textures/buildings/wood.jpg',
    tileWidthM: 4.4,
    tileHeightM: 2.2,
  },
  'roof-tile': {
    id: 'roof-tile',
    url: '/textures/buildings/roof-tile.jpg',
    tileWidthM: 1.5,
    tileHeightM: 1.5,
  },
  'roof-felt': {
    id: 'roof-felt',
    url: '/textures/buildings/roof-felt.jpg',
    tileWidthM: 1.2,
    tileHeightM: 1.2,
  },
  'roof-metal': {
    id: 'roof-metal',
    url: '/textures/buildings/roof-metal.jpg',
    tileWidthM: 2.0,
    tileHeightM: 2.0,
  },
}

/** Default wall/roof skin per building kind. */
export const KIND_SKINS: Record<string, KindSkinPreset> = {
  house: { wall: 'brick', roof: 'roof-tile' },
  apartments: { wall: 'plaster', roof: 'roof-felt' },
  building: { wall: 'plaster', roof: 'roof-felt' },
  commercial: { wall: 'plaster', roof: 'roof-felt' },
  public: { wall: 'plaster', roof: 'roof-felt' },
  church: { wall: 'stone', roof: 'roof-tile' },
  industrial: { wall: 'metal', roof: 'roof-metal' },
  garage: { wall: 'metal', roof: 'roof-metal' },
  farm: { wall: 'wood', roof: 'roof-tile' },
}

export function presetForKind(kind: string): KindSkinPreset {
  const k = normalizeKind(kind)
  return KIND_SKINS[k] ?? KIND_SKINS.building
}

const textureCache = new Map<string, THREE.Texture>()
let loader: THREE.TextureLoader | null = null

function getLoader(): THREE.TextureLoader {
  if (!loader) loader = new THREE.TextureLoader()
  return loader
}

/** Load (and cache) a skin albedo with meter-based repeat setup done by caller. */
export function loadSkinTexture(skinId: string): THREE.Texture | null {
  const def = SKINS[skinId]
  if (!def) return null
  const cached = textureCache.get(skinId)
  if (cached) return cached

  const tex = getLoader().load(def.url)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  textureCache.set(skinId, tex)
  return tex
}

export function skinDef(skinId: string): SkinDef | null {
  return SKINS[skinId] ?? null
}

/** Shared MeshStandardMaterial for a wall or roof skin (one per skin id). */
const materialCache = new Map<string, THREE.MeshStandardMaterial>()

export function getSkinMaterial(
  skinId: string,
  role: 'wall' | 'roof',
): THREE.MeshStandardMaterial {
  const key = `${role}:${skinId}`
  const hit = materialCache.get(key)
  if (hit) return hit

  const def = SKINS[skinId]
  const baseMap = loadSkinTexture(skinId)
  // Clone so wall/roof can have independent repeat without fighting the cache
  const map = baseMap ? baseMap.clone() : null
  if (map && def) {
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.RepeatWrapping
    map.colorSpace = THREE.SRGBColorSpace
    map.repeat.set(1 / def.tileWidthM, 1 / def.tileHeightM)
    map.needsUpdate = true
  }

  const mat = new THREE.MeshStandardMaterial({
    map: map ?? undefined,
    color: '#ffffff',
    flatShading: true,
    roughness: role === 'roof' ? 0.92 : 0.85,
    metalness: skinId.includes('metal') ? 0.35 : 0.04,
  })
  materialCache.set(key, mat)
  return mat
}

export function disposeSkinMaterials(): void {
  for (const m of materialCache.values()) {
    m.map = null
    m.dispose()
  }
  materialCache.clear()
  for (const t of textureCache.values()) t.dispose()
  textureCache.clear()
}
