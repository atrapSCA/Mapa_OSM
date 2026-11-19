import { useLayers } from '@/store/layers'
import type { RegionManifest } from '@shared/tileFormat'

type ToggleDef = {
  key:
    | 'terrain'
    | 'hypsometric'
    | 'wireframe'
    | 'flatShading'
    | 'grid'
    | 'softLight'
    | 'water'
    | 'forests'
    | 'buildings'
    | 'roads'
    | 'labels'
  title: string
  hint: string
  phase: 'now' | 'next'
}

const TOGGLES: ToggleDef[] = [
  {
    key: 'terrain',
    title: 'Výškový terén',
    hint: 'Low-poly mesh z DEM dlaždic',
    phase: 'now',
  },
  {
    key: 'hypsometric',
    title: 'Barevná výška',
    hint: 'Zelená údolí → béžové hřebeny',
    phase: 'now',
  },
  {
    key: 'flatShading',
    title: 'Flat shading',
    hint: 'Facetovaný low-poly vzhled',
    phase: 'now',
  },
  {
    key: 'wireframe',
    title: 'Wireframe',
    hint: 'Kontrola triangulace',
    phase: 'now',
  },
  {
    key: 'grid',
    title: 'Pomocná mřížka',
    hint: 'Orientace ve scéně',
    phase: 'now',
  },
  {
    key: 'softLight',
    title: 'Měkké světlo',
    hint: 'Ambient + hemisphere',
    phase: 'now',
  },
  {
    key: 'water',
    title: 'Voda / potoky',
    hint: 'OSM waterway — připraveno',
    phase: 'next',
  },
  {
    key: 'forests',
    title: 'Lesy + stromy',
    hint: 'OSM forest → scatter stromů',
    phase: 'next',
  },
  {
    key: 'buildings',
    title: 'Budovy',
    hint: 'OSM building extrude',
    phase: 'next',
  },
  {
    key: 'roads',
    title: 'Silnice',
    hint: 'OSM highway linie',
    phase: 'next',
  },
  {
    key: 'labels',
    title: 'Popisky / piny',
    hint: 'Billboard štítky jako na referenci',
    phase: 'next',
  },
]

export function SidePanel({
  manifest,
}: {
  manifest: RegionManifest | null
}) {
  const layers = useLayers()

  return (
    <aside className="side-panel">
      <div className="brand">
        <h1>Mapa OSM</h1>
        <p>
          3D low-poly mapa ze výškových dlaždic. Nejdřív Rakovník 10×10 km —
          stejný formát později pro celý svět.
        </p>
      </div>

      <div className="section">
        <h2>Vrstvy — teď</h2>
        <div className="toggle-list">
          {TOGGLES.filter((t) => t.phase === 'now').map((t) => {
            const on = layers[t.key]
            return (
              <button
                key={t.key}
                type="button"
                className={`toggle${on ? ' on' : ''}`}
                onClick={() => layers.toggle(t.key)}
              >
                <div className="toggle-label">
                  <strong>{t.title}</strong>
                  <span>{t.hint}</span>
                </div>
                <div className="switch" aria-hidden />
              </button>
            )
          })}
        </div>
      </div>

      <div className="section">
        <h2>Připraveno k ladění</h2>
        <div className="toggle-list">
          {TOGGLES.filter((t) => t.phase === 'next').map((t) => {
            const on = layers[t.key]
            return (
              <button
                key={t.key}
                type="button"
                className={`toggle${on ? ' on' : ''}`}
                onClick={() => layers.toggle(t.key)}
                title="Data zatím nejsou — přepínač je připravený na další fázi"
              >
                <div className="toggle-label">
                  <strong>{t.title}</strong>
                  <span>{t.hint}</span>
                </div>
                <div className="switch" aria-hidden />
              </button>
            )
          })}
        </div>
      </div>

      <div className="section">
        <h2>Terén</h2>
        <div className="slider-row">
          <label>
            <span>Výškové zveličení</span>
            <span>{layers.verticalExaggeration.toFixed(1)}×</span>
          </label>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={layers.verticalExaggeration}
            onChange={(e) => layers.setExaggeration(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="stats">
        {manifest ? (
          <>
            <div>{manifest.name}</div>
            <div>
              dlaždice: {manifest.stats.tileCount} @ z{manifest.zoom}
            </div>
            <div>
              výška: {manifest.stats.minElev.toFixed(0)}–
              {manifest.stats.maxElev.toFixed(0)} m
            </div>
            <div>
              mesh: {manifest.stats.grid ?? `${manifest.meshResolution}²`}{' '}
              (souvislý)
            </div>
          </>
        ) : (
          <div>Region nenačten</div>
        )}
      </div>
    </aside>
  )
}
