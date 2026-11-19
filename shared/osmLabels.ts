/** Czech labels for OSM subcategory toggles. */

export type KindGroup =
  | 'roads'
  | 'paths'
  | 'waterways'
  | 'waterPolygons'
  | 'nature'

export const KIND_LABELS: Record<KindGroup, Record<string, string>> = {
  roads: {
    motorway: 'Dálnice',
    trunk: 'Silnice I. (trunk)',
    primary: 'Silnice I. třídy',
    secondary: 'Silnice II. třídy',
    tertiary: 'Silnice III. třídy',
    unclassified: 'Nezařazená',
    residential: 'Obytná zóna',
    living_street: 'Obytná ulice',
    service: 'Účelová / service',
    track: 'Polní / lesní cesta',
    road: 'Obecná silnice',
    roundabout: 'Kruhový objezd',
    pedestrian: 'Pěší zóna / náměstí',
  },
  paths: {
    footway: 'Chodník',
    path: 'Stezka / path',
    steps: 'Schody',
    cycleway: 'Cyklostezka',
    bridleway: 'Jezdecká stezka',
    corridor: 'Koridor',
    track: 'Turistický track',
  },
  waterways: {
    river: 'Řeka',
    stream: 'Potok',
    canal: 'Kanál',
    drain: 'Odvodnění',
    ditch: 'Příkop',
  },
  waterPolygons: {
    water: 'Vodní plocha',
    reservoir: 'Přehrada / nádrž',
    basin: 'Bazén / basin',
  },
  nature: {
    forest: 'Les / wood',
    scrub: 'Křoviny / scrub',
    grassland: 'Louka / tráva',
    heath: 'Vřesoviště',
    farmland: 'Orná půda',
    orchard: 'Sad',
    vineyard: 'Vinice',
    wetland: 'Mokřad',
    park: 'Park / zahrada',
    cemetery: 'Hřbitov',
    allotments: 'Zahrádkářská osada',
    sand: 'Písek / pláž',
    bare_rock: 'Skála / sutě',
  },
}

/** Collapse motorway_link → motorway for fewer toggles. */
export function normalizeKind(kind: string): string {
  return kind.replace(/_link$/, '')
}

export function labelFor(group: KindGroup, kind: string): string {
  const n = normalizeKind(kind)
  return KIND_LABELS[group][n] ?? n
}

export function kindKey(group: KindGroup, kind: string): string {
  return `${group}:${normalizeKind(kind)}`
}
