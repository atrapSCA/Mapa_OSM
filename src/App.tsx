import { useEffect } from 'react'
import { SidePanel } from '@/components/SidePanel'
import { Scene } from '@/components/Scene'
import { useRegionManifest } from '@/hooks/useRegionManifest'
import { useSelection } from '@/store/selection'

const REGION_ID = 'rakovnik'

export function App() {
  const { data, error, loading } = useRegionManifest(REGION_ID)
  const clearSelection = useSelection((s) => s.clear)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection])

  return (
    <div className="app">
      <SidePanel
        manifest={data?.manifest ?? null}
        water={data?.water ?? null}
        roads={data?.roads ?? null}
        nature={data?.nature ?? null}
        buildings={data?.buildings ?? null}
      />
      <main className="viewport">
        {loading && <div className="loading">Načítám terén Rakovník…</div>}
        {error && (
          <div className="error-box">
            <div>
              <strong>Terén ještě není vygenerovaný</strong>
              <p>{error}</p>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>
                npm run pipeline:rakovnik
              </p>
            </div>
          </div>
        )}
        {data && <Scene region={data} />}
        <div className="hud">
          LMB otáčet · RMB posun · kolečko zoom · klikni na budovu · Esc zruší
          výběr · region {REGION_ID}
        </div>
      </main>
    </div>
  )
}
