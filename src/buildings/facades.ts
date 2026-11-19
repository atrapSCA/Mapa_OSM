import type { Building } from '@shared/tileFormat'
import { normalizeKind } from '@shared/osmLabels'

/**
 * CZ aerial look: cream + warm pastels dominate (yellow, peach, mint, sky).
 * Greys only for industrial — houses should not read as a grey town.
 */

/** Family / town houses — almost no grey; cream + clear pastels. */
export const CZ_FACADE_COLORS = [
  // cream / warm white
  '#fff8ec',
  '#faf0dc',
  '#f5e8d0',
  '#f0e2c8',
  '#fff5e6',
  // yellow / ochre (common in CZ centres)
  '#f5e090',
  '#f0d878',
  '#ebd060',
  '#e8c850',
  '#f8e8a8',
  '#f2dc80',
  // peach / salmon / dusty rose
  '#f5d0c4',
  '#f0c0b0',
  '#ebb0a0',
  '#f8d8d0',
  '#e8a898',
  // mint / sage
  '#c8e8c0',
  '#b8e0b0',
  '#a8d8a0',
  '#d0f0d0',
  // sky / light blue
  '#c0dcf0',
  '#b0d0ec',
  '#a0c4e8',
  '#d0e8f8',
  // soft lilac / pink
  '#f0d0e0',
  '#e8c8d8',
] as const

/** Panelák revitalisation — pastel accents first, light warm base (not concrete grey). */
const CZ_FACADE_PANEL = [
  '#f5f0e8',
  '#efe8dc',
  '#f0e6c8',
  '#ebe0a0',
  '#e8d878',
  '#d8c860',
  '#c8e0f0',
  '#b0d0e8',
  '#98c0e0',
  '#c0e0c8',
  '#a8d4b0',
  '#f0c8b8',
  '#e8b0a0',
  '#e0a090',
  '#d8e8f0',
  '#f8e8c0',
] as const

/** Industrial / garage only. */
const CZ_FACADE_GREYS = [
  '#d0ccc8',
  '#c0bcb8',
  '#b0aca8',
  '#a09c98',
  '#949088',
  '#e0dcd8',
] as const

const CZ_FACADE_STONE = [
  '#f0e8dc',
  '#e8e0d0',
  '#e0d8c4',
  '#d8d0bc',
  '#f5edd8',
] as const

function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** Warm pastel façades; industrial stays grey. */
export function facadeColorForBuilding(b: Building): string {
  const kind = normalizeKind(b.kind)

  let palette: readonly string[] = CZ_FACADE_COLORS
  if (kind === 'industrial' || kind === 'garage') {
    palette = CZ_FACADE_GREYS
  } else if (kind === 'church') {
    palette = CZ_FACADE_STONE
  } else if (kind === 'apartments') {
    palette = CZ_FACADE_PANEL
  }
  // commercial / public / house / building → lively town palette

  const i = Math.floor(hash01(b.id + ':facade') * palette.length) % palette.length
  return palette[i]
}
