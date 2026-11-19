import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'

/**
 * Typical CZ town / sídliště façades (from aerial refs):
 * cream & off-white dominate; dusty pastels (ochre, peach, sage, sky);
 * never neon. Paneláky lean greyer with pastel accents.
 */

/** Historic / family houses — cream first, then dusty pastels. */
export const CZ_FACADE_COLORS = [
  // off-white / cream (majority feel)
  '#f2efe8',
  '#ebe6dc',
  '#e4ddd2',
  '#ddd6ca',
  '#f5f2ea',
  '#e8e2d6',
  '#d9d2c6',
  // beige / warm grey
  '#d4cfc4',
  '#c8c2b6',
  '#e0d8cc',
  // pale yellow / sun ochre
  '#f0e6b8',
  '#e8dca0',
  '#e0d090',
  '#f2e8c4',
  // dusty peach / salmon
  '#efd8d0',
  '#e8ccc4',
  '#e0c0b4',
  '#f2e0d8',
  // pale mint / sage
  '#d0e0d4',
  '#c4d8c8',
  '#b8d0bc',
  // pale sky / grey-blue
  '#d0dce8',
  '#c4d4e4',
  '#b8cce0',
  // dusty rose
  '#e8d0d4',
  '#e0c8cc',
] as const

/** Panelák revitalisation — light grey/beige + pastel accents. */
const CZ_FACADE_PANEL = [
  '#e8e6e2',
  '#ddd9d4',
  '#d0ccc6',
  '#c4c0ba',
  '#b8b4ae',
  '#ebe4d6',
  '#e0d8c8',
  // pastel bands (ochre, blue, green, salmon)
  '#e8d890',
  '#d8c878',
  '#a8c4d8',
  '#98b8d0',
  '#b0d0b8',
  '#a0c4a8',
  '#e0b8b0',
  '#d8a8a0',
  '#c8d8e0',
] as const

/** Industrial / garage — cool concrete greys. */
const CZ_FACADE_GREYS = [
  '#d0ccc8',
  '#c0bcb8',
  '#b0aca8',
  '#a09c98',
  '#949088',
  '#e0dcd8',
  '#888480',
] as const

/** Stone / church. */
const CZ_FACADE_STONE = [
  '#e0d8cc',
  '#d4ccc0',
  '#c8c0b4',
  '#bcb4a8',
  '#d0c8b8',
] as const

function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** Façade colour matching typical CZ aerial palette. */
export function facadeColorForBuilding(b: Building): string {
  const kind = normalizeKind(b.kind)
  const h = hash01(b.id)

  let palette: readonly string[] = CZ_FACADE_COLORS
  if (kind === 'industrial' || kind === 'garage') {
    palette = CZ_FACADE_GREYS
  } else if (kind === 'church') {
    palette = CZ_FACADE_STONE
  } else if (kind === 'apartments') {
    palette = CZ_FACADE_PANEL
  } else if (kind === 'commercial' || kind === 'public') {
    // mix of cream town + occasional panel pastel
    palette = h < 0.35 ? CZ_FACADE_PANEL : CZ_FACADE_COLORS
  }

  const i = Math.floor(hash01(b.id + ':facade') * palette.length) % palette.length
  return palette[i]
}
