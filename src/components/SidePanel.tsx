import { useMemo } from 'react'
import { useLayers } from '@/store/layers'
import type {
  BuildingLayerJson,
  NatureLayerJson,
  RegionManifest,
  RoadLayerJson,
  WaterLayerJson,
} from '@shared/tileFormat'
import {
  labelFor,
  normalizeKind,
  type KindGroup,
} from '@shared/osmLabels'

type ToggleDef = {
  key:
    | 'terrain'
    | 'hypsometric'
    | 'wireframe'
    | 'flatShading'
    | 'grid'
    | 'softLight'
    | 'water'
    | 'roads'
    | 'paths'
    | 'nature'
    | 'buildings'
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
    key: 'nature',
    title: 'Příroda',
    hint: 'Lesy, louky, pole, parky…',
    phase: 'now',
  },
  {
    key: 'water',
    title: 'Voda',
    hint: 'Zapne vodu — plochy a toky zvlášť níže',
    phase: 'now',
  },
  {
    key: 'roads',
    title: 'Silnice',
    hint: 'Silniční síť — podkategorie níže',
    phase: 'now',
  },
  {
    key: 'paths',
    title: 'Chodníky / stezky',
    hint: 'Pěší a turistické — podkategorie níže',
    phase: 'now',
  },
  {
    key: 'buildings',
    title: 'Budovy',
    hint: 'Extrudované půdorysy z OSM',
    phase: 'now',
  },
  {
    key: 'labels',
    title: 'Popisky / piny',
    hint: 'Billboard štítky jako na referenci',
    phase: 'next',
  },
]

function collectKinds(
  items: { kind: string }[] | undefined,
): { kind: string; count: number }[] {
  if (!items?.length) return []
  const map = new Map<string, number>()
  for (const it of items) {
    const k = normalizeKind(it.kind)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => a.kind.localeCompare(b.kind))
}

function SubKindToggles({
  group,
  kinds,
}: {
  group: KindGroup
  kinds: { kind: string; count: number }[]
}) {
  const isKindOn = useLayers((s) => s.isKindOn)
  const toggleKind = useLayers((s) => s.toggleKind)
  const kindEnabled = useLayers((s) => s.kindEnabled)
  void kindEnabled

  if (!kinds.length) return null

  return (
    <div className="sub-toggles">
      {kinds.map(({ kind, count }) => {
        const on = isKindOn(group, kind)
        return (
          <button
            key={`${group}:${kind}`}
            type="button"
            className={`toggle sub${on ? ' on' : ''}`}
            onClick={() => toggleKind(group, kind)}
          >
            <div className="toggle-label">
              <strong>{labelFor(group, kind)}</strong>
              <span>
                {kind} · {count}
              </span>
            </div>
            <div className="switch" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

export function SidePanel({
  manifest,
  water,
  roads,
  nature,
  buildings,
}: {
  manifest: RegionManifest | null
  water: WaterLayerJson | null
  roads: RoadLayerJson | null
  nature: NatureLayerJson | null
  buildings: BuildingLayerJson | null
}) {
  const layers = useLayers()

  const roadKinds = useMemo(() => collectKinds(roads?.roads), [roads])
  const pathKinds = useMemo(() => collectKinds(roads?.paths), [roads])
  const waterwayKinds = useMemo(
    () => collectKinds(water?.waterways),
    [water],
  )
  const waterPolyKinds = useMemo(
    () => collectKinds(water?.polygons),
    [water],
  )
  const natureKinds = useMemo(
    () => collectKinds(nature?.polygons),
    [nature],
  )
  const buildingKinds = useMemo(
    () => collectKinds(buildings?.buildings),
    [buildings],
  )

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
              <div key={t.key} className="toggle-block">
                <button
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
                {t.key === 'nature' && on && (
                  <SubKindToggles group="nature" kinds={natureKinds} />
                )}
                {t.key === 'water' && on && (
                  <>
                    <button
                      type="button"
                      className={`toggle sub${layers.waterPolygons ? ' on' : ''}`}
                      onClick={() => layers.toggle('waterPolygons')}
                    >
                      <div className="toggle-label">
                        <strong>Vodní plochy</strong>
                        <span>jezera, rybníky, nádrže…</span>
                      </div>
                      <div className="switch" aria-hidden />
                    </button>
                    {layers.waterPolygons && waterPolyKinds.length > 0 && (
                      <SubKindToggles
                        group="waterPolygons"
                        kinds={waterPolyKinds}
                      />
                    )}
                    <button
                      type="button"
                      className={`toggle sub${layers.waterways ? ' on' : ''}`}
                      onClick={() => layers.toggle('waterways')}
                    >
                      <div className="toggle-label">
                        <strong>Toky</strong>
                        <span>řeky, potoky, kanály…</span>
                      </div>
                      <div className="switch" aria-hidden />
                    </button>
                    {layers.waterways && waterwayKinds.length > 0 && (
                      <SubKindToggles
                        group="waterways"
                        kinds={waterwayKinds}
                      />
                    )}
                  </>
                )}
                {t.key === 'roads' && on && (
                  <SubKindToggles group="roads" kinds={roadKinds} />
                )}
                {t.key === 'paths' && on && (
                  <SubKindToggles group="paths" kinds={pathKinds} />
                )}
                {t.key === 'buildings' && on && (
                  <>
                    <button
                      type="button"
                      className={`toggle sub${layers.buildingSkins ? ' on' : ''}`}
                      onClick={() => layers.toggle('buildingSkins')}
                    >
                      <div className="toggle-label">
                        <strong>Skiny budov</strong>
                        <span>OSM Texture Library — fasáda + střecha</span>
                      </div>
                      <div className="switch" aria-hidden />
                    </button>
                    <SubKindToggles group="buildings" kinds={buildingKinds} />
                  </>
                )}
              </div>
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
            {manifest.stats.nature != null && (
              <div>příroda: {manifest.stats.nature} ploch</div>
            )}
            {manifest.stats.buildings != null && (
              <div>budovy: {manifest.stats.buildings}</div>
            )}
            {manifest.stats.waterways != null && (
              <div>
                voda: {manifest.stats.waterways} toků,{' '}
                {manifest.stats.waterPolygons ?? 0} ploch
              </div>
            )}
            {manifest.stats.roads != null && (
              <div>
                silnice: {manifest.stats.roads}, stezky:{' '}
                {manifest.stats.paths ?? 0}
              </div>
            )}
          </>
        ) : (
          <div>Region nenačten</div>
        )}
      </div>
    </aside>
  )
}
