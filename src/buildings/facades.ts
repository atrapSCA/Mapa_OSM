import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'

/**
 * CZ plaster / paint — a bit livelier pastels (not neon).
 * Fewer greys; more yellow, blue, green, peach.
 */
export const CZ_FACADE_COLORS = [
  // light neutrals (few)
  '#ebe4d6',
  '#e2d8c8',
  '#d6cfc4',
  // yellow / ochre — clearer
  '#f0e09a',
  '#e8d078',
  '#e0c86a',
  '#d4b85c',
  '#f2e8b0',
  // peach / salmon
  '#efcfc0',
  '#e8b8a8',
  '#e0a898',
  '#f0d8d0',
  // green
  '#b8d4a8',
  '#a8c898',
  '#98c090',
  '#c4dcb0',
  '#a0c8a0',
  // blue / grey-blue
  '#a8c4e0',
  '#98b8d8',
  '#b0cce8',
  '#90b0d0',
  '#c0d4e8',
  // mint / sage
  '#a8d4c8',
  '#98c8bc',
  '#b8ddd0',
  // soft lilac / dusty rose
  '#dcc8d4',
  '#e8c8c8',
] as const

/** Industrial / garage — mostly grey (quiet concrete / metal). */
const CZ_FACADE_GREYS = [
  '#c4c0ba',
  '#b4b0aa',
  '#a4a09a',
  '#949088',
  '#888480',
  '#b8b4ae',
  '#d0ccc6',
] as const

/** Stone-ish for churches. */
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

/** Façade colour: industrial grey; others livelier pastels. */
export function facadeColorForBuilding(b: Building): string {
  const kind = normalizeKind(b.kind)
  const h = hash01(b.id)

  let palette: readonly string[] = CZ_FACADE_COLORS
  if (kind === 'industrial' || kind === 'garage') {
    palette = CZ_FACADE_GREYS
  } else if (kind === 'church') {
    palette = CZ_FACADE_STONE
  } else if (kind === 'apartments') {
    // Mostly tinted; only occasional grey panelák
    palette = h < 0.22 ? CZ_FACADE_GREYS : CZ_FACADE_COLORS
  }

  const i = Math.floor(hash01(b.id + ':facade') * palette.length) % palette.length
  return palette[i]
}
