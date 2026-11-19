import { create } from 'zustand'

/**
 * Temporary experiment toggles — turn layers on/off to decide what stays
 * when scaling from Rakovník → world.
 */
export type LayerState = {
  terrain: boolean
  hypsometric: boolean
  wireframe: boolean
  flatShading: boolean
  grid: boolean
  softLight: boolean
  /** Placeholders for next phases */
  water: boolean
  forests: boolean
  buildings: boolean
  roads: boolean
  labels: boolean
  verticalExaggeration: number
  setLayer: <K extends keyof Omit<LayerState, 'setLayer' | 'setExaggeration'>>(
    key: K,
    value: LayerState[K],
  ) => void
  setExaggeration: (v: number) => void
  toggle: (key: keyof Omit<LayerState, 'setLayer' | 'setExaggeration' | 'verticalExaggeration' | 'toggle'>) => void
}

export const useLayers = create<LayerState>((set) => ({
  terrain: true,
  hypsometric: true,
  wireframe: false,
  flatShading: true,
  grid: false,
  softLight: true,
  water: false,
  forests: false,
  buildings: false,
  roads: false,
  labels: false,
  verticalExaggeration: 2.2,
  setLayer: (key, value) => set({ [key]: value }),
  setExaggeration: (verticalExaggeration) => set({ verticalExaggeration }),
  toggle: (key) => set((s) => ({ [key]: !s[key] })),
}))
