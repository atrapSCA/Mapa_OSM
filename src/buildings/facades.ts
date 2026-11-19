import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'

/**
 * Soft CZ plaster / paint hues — muted, never neon.
 * Greys, creams, soft yellow, blue, green, ochre, dusty rose.
 */
export const CZ_FACADE_COLORS = [
  // greys / off-white
  '#d8d4ce',
  '#c9c5bf',
  '#b8b4ae',
  '#a8a49e',
  '#e4e0da',
  '#d0ccc4',
  // cream / warm white
  '#e8e0d0',
  '#ddd4c4',
  '#d4cbb8',
  // soft yellow / ochre
  '#e6d9a8',
  '#dccfa0',
  '#d4c090',
  '#cbb888',
  // soft peach / dusty rose
  '#e0cfc4',
  '#d8c4b8',
  '#d0b8b0',
  // soft green
  '#c5d0c0',
  '#b8c8b4',
  '#c0cbb0',
  '#a8b8a4',
  // soft blue / grey-blue
  '#c0ccd8',
  '#b4c4d0',
  '#c8d0d8',
  '#a8b8c4',
  // soft sage / teal-grey
  '#b8c8c4',
  '#c0d0cc',
] as const

/** Industrial / garage — only quiet greys. */
const CZ_FACADE_GREYS = [
  '#c8c4be',
  '#b8b4ae',
  '#a8a49e',
  '#9a9690',
  '#d0ccc6',
  '#bcb8b2',
] as const

/** Stone-ish for churches / public. */
const CZ_FACADE_STONE = [
  '#d4ccc0',
  '#c8c0b4',
  '#bcb4a8',
  '#d0c8b8',
  '#c4bcaa',
] as const

function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** Stable muted façade colour per building. */
export function facadeColorForBuilding(b: Building): string {
  const kind = normalizeKind(b.kind)
  const h = hash01(b.id)

  let palette: readonly string[] = CZ_FACADE_COLORS
  if (kind === 'industrial' || kind === 'garage') palette = CZ_FACADE_GREYS
  else if (kind === 'church') palette = CZ_FACADE_STONE
  else if (kind === 'apartments') {
    // Paneláky: mostly grey/cream, occasional soft tint
    palette = h < 0.55 ? CZ_FACADE_GREYS : CZ_FACADE_COLORS
  }

  const i = Math.floor(hash01(b.id + ':facade') * palette.length) % palette.length
  return palette[i]
}
