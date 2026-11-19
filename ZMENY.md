# Záznam změn

Číslování: `0.0.XX` (patch při každé změně).

---

## 0.0.21 — 2026-11-19

### Přidáno
- **Dva režimy ploch** v menu „Režim ploch“:
  - **V1 — drape** (git tag `v1-drape`): oddělené densifikované polygony na DEM
  - **V2 — textura**: landcover 2048² na jednom terénním meshi (příroda + vodní plochy)
- Toky/silnice zůstávají ribbon v obou režimech

---

## 0.0.20 — 2026-11-19

### Změněno
- **Příroda** (les, louky, pole…) stejně jako voda: drapovaný OSM polygon + výšky z DEM
- Konec barvení do terénní mřížky → okraje lesa už nejsou kostrbaté čtverečky
- Terén zůstává čistý hypsometrický mesh; příroda pod vodou (lift 0.85 vs 1.6)

---

## 0.0.19 — 2026-11-19

### Opraveno
- Vypnutí **Vodní plochy** opravdu skryje všechna jezera/rybníky (oddělený přepínač `waterPolygons`)
- Toky mají vlastní přepínač `waterways` — už se nemíchají s plochami
- Mokřady v přírodě mají olivovou barvu (nepletou se s modrou vodou)

---

## 0.0.18 — 2026-11-19

### Opraveno
- **Vodní plochy** znovu jako samostatné drapované polygony (hladký OSM obrys, jako dřív)
- Voda se už nebarví do terénní mřížky (to je rozbíjelo)
- Příroda: jemnější barvení přes 4× subdivizi každé DEM buňky (~25 m) bez děr
- Výchozí `meshResolution` regionu → 320 (přegeneruj: `npm run pipeline:rakovnik`)

---

## 0.0.17 — 2026-11-19

### Opraveno
- Rozmazané lesy: barvy už nejsou na sdílených vertexech (interpolace), ale **per-face** na buňkách terénu
- Ostré low-poly plochy bez gradientového „heatmap“ efektu

---

## 0.0.16 — 2026-11-19

### Opraveno
- Díry v lesích (Z-fighting): příroda + vodní plochy se barví přímo do terénní mřížky → ucelená plocha
- Oddělený mesh přírody zrušen; vodní toky zůstávají ribbon

### Přidáno
- Volby vrstev / podkategorií v menu se **ukládají** (`localStorage`, zustand persist)

---

## 0.0.15 — 2026-11-19

### Opraveno
- Plochy přírody/vody už nejsou **čtverečkované** (osa-aligned stamp mřížky terénu)
- Místo toho: husté drapování OSM obrysu + subdivision + výšky z DEM → plastický profil bez pixelových hran

---

## 0.0.14 — 2026-11-19

### Změněno
- Plochy **Příroda** a **Voda** (polygony) už nejsou ploché desky
- Vykreslují se jako faceted low-poly mesh ze stejné mřížky jako výškový terén (`stampPolygonsOnTerrain`)
- Každá buněčná plocha terénu uvnitř OSM polygonu dostane výšku z DEM rohů → kopíruje profil terénu

---

## 0.0.13 — 2026-11-19

### Opraveno
- Vrstva **Příroda** nešla vidět / padala
- `DoubleSide` + vyšší lift nad terénem
- 32-bit index při merge stovek polygonů (přetečení Uint16)
- try/catch + orientace ringů pro Shape triangulaci

---

## 0.0.12 — 2026-11-19

### Přidáno
- Přírodní vrstvy z OSM (`scripts/osm-nature.ts` → `osm/nature.json`)
- Master přepínač **Příroda** + podkategorie: forest, scrub, grassland, heath, farmland, orchard, vineyard, wetland, park, cemetery, allotments, sand, bare_rock
- 3D drapované polygony na terénu (`NatureLayer`)
- Pořadí: terén → příroda → voda → silnice

---

## 0.0.11 — 2026-11-19

### Opraveno
- Vodní plocha se vykresluje **nad** potokem/řekou (vyšší lift + renderOrder, toky dřív v pořadí)

---

## 0.0.10 — 2026-11-19

### Opraveno (kritické)
- Silnice (secondary/residential/…) se omylem kreslily jako **stezka**
- Příčina: Overpass `out skel` přepsal tagged ways verzí **bez tagů**; úseky v KČT relacích pak skončily jako `path`
- Preferovat vždy tagged way/node; turistické relace už silnice nedemotují
- `track` zůstává ve vrstvě silnic (jako u běžných mapových stylů)

---

## 0.0.09 — 2026-11-19

### Opraveno
- Úseky vypadající jako silnice, ale kreslené jako stezka
- `pedestrian` + pojmenované footway/path (ne sidewalk) → vrstva **silnice**
- `junction=roundabout` a cesty s `motor_vehicle=yes` → silnice
- Místo ořezu konců: mírné **prodloužení** ribbonů, ať v křižovatkách nevznikají mezery se stezkou pod nimi

---

## 0.0.08 — 2026-11-19

### Opraveno
- Chodníky / stezky se vždy vykreslují **pod** silnicemi (nižší lift + renderOrder)

---

## 0.0.07 — 2026-11-19

### Opraveno
- Viditelná napojení silnic (tmavší kříže v křižovatkách)
- Silnice/stezky: jeden sloučený mesh + `MeshBasicMaterial` (jednolitá barva, bez světelného překryvu)
- Mírné zkrácení otevřených konců ribbonů, ať flat-cap nepřetíná hlavní silnici

---

## 0.0.06 — 2026-11-19

### Změněno
- Silnice, zatáčky, kruhové objezdy (i stezky/voda přes ribbon) se vykreslují jako **Catmull-Rom křivky** (`centripetal`)
- Hustší vzorkování na kruháčích, spojitý triangle strip podél tečny křivky

---

## 0.0.05 — 2026-11-19

### Opraveno
- Nedokreslené silnice a kruhové objezdy — ribbon je teď **po segmentech** (bez miter překlapů)
- Uzavírání nearly-closed prstenců (mezera po projekci do metrů)
- Hustší geometrie closed rings + širší `junction=roundabout`
- Podkategorie **Kruhový objezd** (`roundabout`)

---

## 0.0.04 — 2026-11-19

### Přidáno
- Podkategorie OSM jako samostatné přepínače (vnořené pod master vrstvou)
- **Silnice:** motorway, trunk, primary, secondary, tertiary, residential, service, track, …
- **Chodníky / stezky:** footway, path, pedestrian, steps, cycleway, …
- **Voda:** toky (river, stream, canal, …) + plochy (water, reservoir, basin)
- České popisky + počet prvků u každé podkategorie
- `_link` typy sloučeny s rodičem (motorway_link → motorway)

---

## 0.0.03 — 2026-11-19

### Přidáno
- OSM silniční síť (`scripts/osm-roads.ts` → `osm/roads.json`)
- 3D vrstva `RoadsLayer` (ribbon na terénu)
- Přepínač **Silnice** — motorway…residential, service, track
- Přepínač **Chodníky / stezky** — footway, path, pedestrian, steps, cycleway + turistické `route=hiking`

### Technické
- Sdílená `ribbonGeometry` / `mergeRibbons` pro vodu i silnice
- Stezky a silnice jdou vypínat nezávisle

---

## 0.0.02 — 2026-11-19

### Přidáno
- OSM vodní toky a vodní plochy přes Overpass (`scripts/osm-water.ts`)
- Výstup `osm/water.json` + cesta v manifestu
- 3D vrstva `WaterLayer`: ribbon toky + polygon plochy drapované na terén
- Přepínač „Voda / potoky“ napojený na reálná data (výchozí zapnuto)

### Technické
- Výška vody se vzorkuje z continuous DEM (reaguje na výškové zveličení)
- Cache raw Overpass odpovědi v `data/raw/{region}/osm/`

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
