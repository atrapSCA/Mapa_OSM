# Mapa OSM — 3D low-poly svět

Lokální 3D mapa z výškových dat (DEM) + později OpenStreetMap.  
**Teď:** 25×25 km kolem Rakovníku. **Cíl:** stejný pipeline pro celý svět, data na PC serveru.

## Proč dlaždice (tiles)

Celý svět nejde načíst najednou. Všechno je proto v **slippy-map dlaždicích** (`z/x/y`):

```
data/tiles/{region}/manifest.json
data/tiles/{region}/terrain/{z}/{x}/{y}.json
```

Stejný formát funguje pro 10 km i pro planetu — jen přibývají dlaždice a později LOD (více zoom úrovní).

## Rychlý start

```bash
npm install
npm run pipeline:rakovnik   # stáhne DEM (AWS Terrarium) + low-poly mesh
npm run dev                 # http://localhost:5173
```

Na PC serveru po odladění:

```bash
npm run build
npm run serve:tiles         # http://localhost:8787
```

## Fáze

| Fáze | Stav | Obsah |
|------|------|--------|
| 1 | **teď** | Výškový low-poly terén, hypsometrické barvy, boční přepínače |
| 2 | další | OSM objekty (voda, lesy/stromy, budovy, silnice, piny) |
| 3 | později | Geofabrik / planet extract, více zoomů, binární glTF dlaždice |
| 4 | cíl | Celý svět na lokálním disku + tile server |

## Zdroje dat

- **Výška:** [AWS Terrain Tiles — Terrarium](https://github.com/tilezen/joerd/blob/master/docs/formats.md) (globální, zdarma)
- **OSM (fáze 2):** Overpass pro malý bbox → Geofabrik Česko → planet.osm.pbf

## Boční menu

Dočasné přepínače slouží k rozhodnutí, co v projektu zůstane. Vrstvy označené „připraveno k ladění“ zatím ukazují placeholdery.

## Vlastní oblast

```bash
npx tsx scripts/build-region.ts --lon 14.42 --lat 50.08 --size 10000 --id praha --name "Praha 10km"
```
