import { create } from 'zustand'

export type SelectionState = {
  selectedId: string | null
  select: (id: string) => void
  clear: () => void
}

export const useSelection = create<SelectionState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
  clear: () => set({ selectedId: null }),
}))
