import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  kindKey,
  normalizeKind,
  type KindGroup,
} from '@shared/osmLabels'

/**
 * Temporary experiment toggles — master layers + OSM subcategory kinds.
 * Persisted to localStorage so choices survive reload.
 */
export type LayerState = {
  terrain: boolean
  hypsometric: boolean
  wireframe: boolean
  flatShading: boolean
  grid: boolean
  softLight: boolean
  water: boolean
  /** Master for water polygon meshes (lakes, ponds…). */
  waterPolygons: boolean
  /** Master for waterway ribbons (streams, rivers…). */
  waterways: boolean
  nature: boolean
  buildings: boolean
  roads: boolean
  paths: boolean
  labels: boolean
  /** `roads:primary`, `nature:forest`, … — missing = on */
  kindEnabled: Record<string, boolean>
  verticalExaggeration: number
  setLayer: <
    K extends keyof Omit<
      LayerState,
      'setLayer' | 'setExaggeration' | 'toggleKind' | 'isKindOn'
    >,
  >(
    key: K,
    value: LayerState[K],
  ) => void
  setExaggeration: (v: number) => void
  toggle: (
    key: keyof Omit<
      LayerState,
      | 'setLayer'
      | 'setExaggeration'
      | 'verticalExaggeration'
      | 'toggle'
      | 'kindEnabled'
      | 'toggleKind'
      | 'isKindOn'
    >,
  ) => void
  toggleKind: (group: KindGroup, kind: string) => void
  isKindOn: (group: KindGroup, kind: string) => boolean
}

type PersistedLayers = Pick<
  LayerState,
  | 'terrain'
  | 'hypsometric'
  | 'wireframe'
  | 'flatShading'
  | 'grid'
  | 'softLight'
  | 'water'
  | 'waterPolygons'
  | 'waterways'
  | 'nature'
  | 'buildings'
  | 'roads'
  | 'paths'
  | 'labels'
  | 'kindEnabled'
  | 'verticalExaggeration'
>

export const useLayers = create<LayerState>()(
  persist(
    (set, get) => ({
      terrain: true,
      hypsometric: true,
      wireframe: false,
      flatShading: true,
      grid: false,
      softLight: true,
      water: true,
      waterPolygons: true,
      waterways: true,
      nature: true,
      buildings: false,
      roads: true,
      paths: true,
      labels: false,
      kindEnabled: {},
      verticalExaggeration: 2.2,
      setLayer: (key, value) => set({ [key]: value }),
      setExaggeration: (verticalExaggeration) => set({ verticalExaggeration }),
      toggle: (key) => set((s) => ({ [key]: !s[key] })),
      toggleKind: (group, kind) => {
        const key = kindKey(group, kind)
        set((s) => {
          const current = s.kindEnabled[key] !== false
          return {
            kindEnabled: { ...s.kindEnabled, [key]: !current },
          }
        })
      },
      isKindOn: (group, kind) => {
        const key = kindKey(group, normalizeKind(kind))
        return get().kindEnabled[key] !== false
      },
    }),
    {
      name: 'mapa-osm-layers-v2',
      partialize: (s): PersistedLayers => ({
        terrain: s.terrain,
        hypsometric: s.hypsometric,
        wireframe: s.wireframe,
        flatShading: s.flatShading,
        grid: s.grid,
        softLight: s.softLight,
        water: s.water,
        waterPolygons: s.waterPolygons,
        waterways: s.waterways,
        nature: s.nature,
        buildings: s.buildings,
        roads: s.roads,
        paths: s.paths,
        labels: s.labels,
        kindEnabled: s.kindEnabled,
        verticalExaggeration: s.verticalExaggeration,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedLayers>
        return {
          ...current,
          ...p,
          // Ensure new flags exist after upgrade from v1 storage
          waterPolygons: p.waterPolygons ?? true,
          waterways: p.waterways ?? true,
          kindEnabled: p.kindEnabled ?? {},
        }
      },
    },
  ),
)
