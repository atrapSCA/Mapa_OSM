/**
 * Low-poly hypsometric palette inspired by stylized Czech mountain maps:
 * valleys → green, mid slopes → light green, ridges → beige / pale yellow.
 */

export type Rgb = [number, number, number]

const STOPS: { elev: number; color: Rgb }[] = [
  { elev: 200, color: [72, 140, 72] },
  { elev: 280, color: [98, 158, 78] },
  { elev: 360, color: [132, 176, 88] },
  { elev: 450, color: [168, 190, 110] },
  { elev: 550, color: [198, 205, 130] },
  { elev: 700, color: [220, 210, 150] },
  { elev: 900, color: [232, 220, 168] },
  { elev: 1200, color: [236, 228, 190] },
  { elev: 1600, color: [245, 238, 210] },
]

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function elevationToRgb(elevMeters: number): Rgb {
  if (elevMeters <= STOPS[0].elev) return STOPS[0].color
  if (elevMeters >= STOPS[STOPS.length - 1].elev) {
    return STOPS[STOPS.length - 1].color
  }
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (elevMeters >= a.elev && elevMeters <= b.elev) {
      const t = (elevMeters - a.elev) / (b.elev - a.elev)
      return [
        Math.round(lerp(a.color[0], b.color[0], t)),
        Math.round(lerp(a.color[1], b.color[1], t)),
        Math.round(lerp(a.color[2], b.color[2], t)),
      ]
    }
  }
  return STOPS[0].color
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
