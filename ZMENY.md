# Záznam změn

Číslování: `0.0.XX` (patch při každé změně).

---

## 0.0.01 — 2026-11-19

První verze projektu **Mapa OSM** — 3D low-poly mapa připravená na škálování z Rakovníku na celý svět.

### Přidáno
- Scaffold Vite + React + TypeScript + Three.js (`@react-three/fiber`, `@react-three/drei`)
- Sdílená geo logika (slippy tiles, bbox, lokální metry) — `shared/geo.ts`
- Hypsometrická paleta výšek (zelená → béžová) — `shared/hypsometric.ts`
- Formát dlaždic / continuous mesh — `shared/tileFormat.ts`
- Pipeline `scripts/build-region.ts`: stažení DEM (AWS Terrarium) + generování terénu
- DEM helper `scripts/dem.ts` + lokální tile server `scripts/serve-tiles.ts`
- 3D viewer: souvislý low-poly terén Rakovník 10×10 km
- Boční menu s přepínači vrstev (terén, barvy, wireframe, placeholdery OSM)
- Spouštěcí `start.bat` (install → pipeline → dev server)
- `README.md` s fázemi a návodem

### Opraveno
- Viditelné čtvercové švy mezi DEM dlaždicemi → jeden souvislý mesh `terrain/continuous.json` (100×100)

### Poznámka k datům
- Raw DEM a vygenerované tiles jsou v `.gitignore` (regenerace: `npm run pipeline:rakovnik` nebo `start.bat`)
