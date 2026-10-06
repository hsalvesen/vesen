// The curated place table and the text matching around it. Curated names resolve with no
// network, the same way every time: the Palestine names the site has always mapped, and the
// Indigenous place names it uses as examples. Labels and points are the owner's choices
// (docs/plan/README.md, decisions table).

import type { CuratedPlace, Place } from './types';

const PS = 'PS';

export const CURATED: readonly CuratedPlace[] = [
  // Palestine. Every key from the legacy table (src/utils/commands/network.ts) is here, with
  // common spelling variants; normaliseQuery makes 'west+bank' and 'khan+younis' match too.
  { keys: ['Palestine', 'State of Palestine', 'Occupied Palestinian Territories', 'Palestinian Territories'],
    name: 'Palestine', countryCode: PS, lat: 31.8996, lon: 35.2042, kind: 'country' },
  { keys: ['West Bank', 'Westbank'], name: 'West Bank', knownAs: 'Ramallah', countryCode: PS,
    lat: 31.8996, lon: 35.2042, kind: 'region' },
  { keys: ['Gaza', 'Gaza City', 'Gaza Strip', 'Ghazzah'], name: 'Gaza', region: 'Gaza Strip', countryCode: PS,
    lat: 31.5016, lon: 34.4667 },
  { keys: ['Khan Younis', 'Khan Yunis', 'Khan Yunus', 'Khan Younes'], name: 'Khan Younis', region: 'Gaza Strip',
    countryCode: PS, lat: 31.3402, lon: 34.3063 },
  { keys: ['Rafah'], name: 'Rafah', region: 'Gaza Strip', countryCode: PS, lat: 31.2972, lon: 34.2436 },
  { keys: ['Ramallah'], name: 'Ramallah', region: 'West Bank', countryCode: PS, lat: 31.8996, lon: 35.2042 },
  { keys: ['Bethlehem', 'Bayt Lahm'], name: 'Bethlehem', region: 'West Bank', countryCode: PS, lat: 31.7049, lon: 35.2038 },
  { keys: ['Hebron', 'Al Khalil'], name: 'Hebron', region: 'West Bank', countryCode: PS, lat: 31.5294, lon: 35.0938 },
  { keys: ['Nablus', 'Nabulus'], name: 'Nablus', region: 'West Bank', countryCode: PS, lat: 32.2211, lon: 35.2544 },
  { keys: ['Jenin'], name: 'Jenin', region: 'West Bank', countryCode: PS, lat: 32.4594, lon: 35.3009 },
  { keys: ['Tulkarm', 'Tulkarem', 'Tulkarim'], name: 'Tulkarm', region: 'West Bank', countryCode: PS,
    lat: 32.3116, lon: 35.0269 },
  { keys: ['Qalqilya', 'Qalqilyah', 'Qalqiliya'], name: 'Qalqilya', region: 'West Bank', countryCode: PS,
    lat: 32.1897, lon: 34.9706 },
  { keys: ['Jericho', 'Ariha'], name: 'Jericho', region: 'West Bank', countryCode: PS, lat: 31.8667, lon: 35.45 },

  // Indigenous place names, each labelled with the city it is better known as.
  { keys: ['Gadigal', 'Gadigal Country', 'Gadigal Land'], name: 'Gadigal Country', knownAs: 'Sydney',
    region: 'New South Wales', countryCode: 'AU', lat: -33.8688, lon: 151.2093 },
  { keys: ['Naarm'], name: 'Naarm', knownAs: 'Melbourne', region: 'Victoria', countryCode: 'AU', lat: -37.814, lon: 144.9633 },
  { keys: ['Meanjin'], name: 'Meanjin', knownAs: 'Brisbane', region: 'Queensland', countryCode: 'AU',
    lat: -27.4679, lon: 153.0281 },
  { keys: ['Boorloo'], name: 'Boorloo', knownAs: 'Perth', region: 'Western Australia', countryCode: 'AU',
    lat: -31.9522, lon: 115.8614 },
  { keys: ['Tarntanya'], name: 'Tarntanya', knownAs: 'Adelaide', region: 'South Australia', countryCode: 'AU',
    lat: -34.9287, lon: 138.5986 },
  { keys: ['nipaluna'], name: 'nipaluna', knownAs: 'Hobart', region: 'Tasmania', countryCode: 'AU',
    lat: -42.8794, lon: 147.3294 },
  { keys: ['Garramilla'], name: 'Garramilla', knownAs: 'Darwin', region: 'Northern Territory', countryCode: 'AU',
    lat: -12.4611, lon: 130.8418 },
  { keys: ['Aotearoa'], name: 'Aotearoa', knownAs: 'Wellington', countryCode: 'NZ', lat: -41.2866, lon: 174.7756 },
  { keys: ['Tāmaki Makaurau'], name: 'Tāmaki Makaurau', knownAs: 'Auckland', countryCode: 'NZ',
    lat: -36.8485, lon: 174.7635 },
  { keys: ['Te Whanganui-a-Tara'], name: 'Te Whanganui-a-Tara', knownAs: 'Wellington', countryCode: 'NZ',
    lat: -41.2866, lon: 174.7756 },
  { keys: ['Ōtautahi'], name: 'Ōtautahi', knownAs: 'Christchurch', region: 'Canterbury', countryCode: 'NZ',
    lat: -43.5333, lon: 172.6333 },
  { keys: ['Ōtepoti'], name: 'Ōtepoti', knownAs: 'Dunedin', region: 'Otago', countryCode: 'NZ', lat: -45.8742, lon: 170.5036 },
  { keys: ['Kirikiriroa'], name: 'Kirikiriroa', knownAs: 'Hamilton', region: 'Waikato', countryCode: 'NZ',
    lat: -37.7833, lon: 175.2833 },
];

/** The canonical spelling of every curated place, for completion, chips and suggestions. */
export const CURATED_NAMES: readonly string[] = CURATED.map((entry) => entry.keys[0] ?? entry.name);

// ── Normalising ────────────────────────────────────────────────────────────────────────────

/**
 * The form names are compared in: case and diacritics ignored, apostrophes and the okina
 * dropped, and + _ - treated as spaces, so 'Tāmaki-Makaurau', 'tamaki makaurau' and
 * 'khan+younis' all match their entries.
 */
export function normaliseQuery(query: string): string {
  return query
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['‘’ʻʼ`´:]/g, '')
    .replace(/[+_\-‐‑‒–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEX: ReadonlyMap<string, CuratedPlace> = new Map(
  CURATED.flatMap((entry) => entry.keys.map((key) => [normaliseQuery(key), entry] as const)),
);

function slug(text: string): string {
  return normaliseQuery(text).replace(/ /g, '-');
}

function toPlace(entry: CuratedPlace): Place {
  const country = countryLabel(entry.countryCode);
  return {
    id: `cur:${slug(entry.keys[0] ?? entry.name)}`,
    name: entry.name,
    ...(entry.knownAs ? { knownAs: entry.knownAs } : {}),
    ...(entry.region ? { region: entry.region } : {}),
    countryCode: entry.countryCode,
    ...(country ? { country } : {}),
    lat: entry.lat,
    lon: entry.lon,
    kind: entry.kind ?? 'city',
    source: 'curated',
  };
}

/**
 * The curated place for a query, or undefined. A qualifier ('Gaza, Palestine') must agree with
 * the entry, so 'Hebron, Kentucky' goes on to the geocoder. Without a comma, trailing words
 * may act as the qualifier: 'gaza palestine', 'naarm victoria'.
 */
export function lookupCurated(query: string, qualifier?: string): Place | undefined {
  const normalised = normaliseQuery(query);
  const entry = INDEX.get(normalised);
  if (entry) {
    if (qualifier === undefined || qualifier.trim() === '' || matchesQualifier(entryFields(entry), qualifier)) {
      return toPlace(entry);
    }
    return undefined;
  }
  if (qualifier !== undefined) return undefined;

  const words = normalised.split(' ');
  for (let tail = 1; tail < words.length && tail <= 3; tail += 1) {
    const head = INDEX.get(words.slice(0, -tail).join(' '));
    if (head && matchesQualifier(entryFields(head), words.slice(-tail).join(' '))) return toPlace(head);
  }
  return undefined;
}

function entryFields(entry: CuratedPlace): QualifierFields {
  return { countryCode: entry.countryCode, region: entry.region, knownAs: entry.knownAs, country: countryLabel(entry.countryCode) };
}

// ── Countries ──────────────────────────────────────────────────────────────────────────────

let regionNames: Intl.DisplayNames | null | undefined;

function displayNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    } catch {
      regionNames = null;
    }
  }
  return regionNames;
}

/** The English name of an ISO 3166-1 alpha-2 region code, or undefined when it is not one. */
function regionName(code: string): string | undefined {
  try {
    return displayNames()?.of(code) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The country name to show for a code. PS is always 'Palestine'; otherwise the browser's own
 * English name, then whatever the provider called it, then the code itself.
 */
export function countryLabel(code?: string | null, providerName?: string | null): string | undefined {
  const upper = code?.trim().toUpperCase();
  if (upper === PS) return 'Palestine';
  if (upper && /^[A-Z]{2}$/.test(upper)) {
    const name = regionName(upper);
    if (name) return name;
  }
  return providerName?.trim() || upper || undefined;
}

/** Codes for private use or groupings, which are never countries. */
const PRIVATE_USE = /^(?:AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN)$/;
/** Withdrawn codes that share a name with a current one: Metropolitan France, Burma, Zaire and so on. */
const WITHDRAWN = new Set(['AN', 'BU', 'CS', 'DD', 'FX', 'NT', 'SU', 'TP', 'UK', 'YU', 'ZR']);

/** Country names people type that the browser's English names do not cover. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: 'US', america: 'US', 'united states of america': 'US',
  uk: 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  palestine: PS, 'state of palestine': PS, 'palestinian territories': PS,
  aotearoa: 'NZ', holland: 'NL', 'czech republic': 'CZ', turkey: 'TR', burma: 'MM', 'ivory coast': 'CI',
  'south korea': 'KR', korea: 'KR', 'north korea': 'KP', russia: 'RU', vietnam: 'VN', laos: 'LA', iran: 'IR', syria: 'SY',
};

let countryIndex: ReadonlyMap<string, string> | undefined;

function countriesByName(): ReadonlyMap<string, string> {
  if (!countryIndex) {
    const index = new Map<string, string>();
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i += 1) {
      for (let j = 0; j < 26; j += 1) {
        const code = String.fromCharCode(A + i, A + j);
        if (PRIVATE_USE.test(code) || WITHDRAWN.has(code)) continue;
        const name = regionName(code);
        const key = name && name !== code ? normaliseQuery(name) : '';
        if (key && !index.has(key)) index.set(key, code);
      }
    }
    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) index.set(alias, code);
    countryIndex = index;
  }
  return countryIndex;
}

/** The ISO code for a typed country name or code: 'France' and 'fr' give 'FR'. */
export function countryCodeFor(text: string): string | undefined {
  const normalised = normaliseQuery(text);
  if (normalised === '') return undefined;
  const byName = countriesByName().get(normalised);
  if (byName) return byName;
  if (/^[a-z]{2}$/.test(normalised)) {
    const code = normalised.toUpperCase();
    if (PRIVATE_USE.test(code)) return undefined;
    // Without Intl.DisplayNames every two-letter code is taken on trust.
    return displayNames() === null || regionName(code) ? code : undefined;
  }
  return undefined;
}

// ── Qualifiers ─────────────────────────────────────────────────────────────────────────────

export interface QualifierFields {
  readonly countryCode?: string | undefined;
  readonly country?: string | undefined;
  readonly region?: string | undefined;
  readonly district?: string | undefined;
  readonly knownAs?: string | undefined;
}

/**
 * True when `qualifier` describes a place: its country by code or name, or its region,
 * district or better-known name by prefix ('il' for Illinois) or initials ('nsw', 'wa').
 */
export function matchesQualifier(fields: QualifierFields, qualifier: string): boolean {
  const wanted = normaliseQuery(qualifier);
  if (wanted === '') return true;
  const code = countryCodeFor(wanted);
  if (code && fields.countryCode?.toUpperCase() === code) return true;
  for (const field of [fields.region, fields.district, fields.country, fields.knownAs]) {
    if (!field) continue;
    const have = normaliseQuery(field);
    if (have === wanted) return true;
    if (wanted.length >= 2 && have.startsWith(wanted)) return true;
    const words = have.split(' ');
    if (wanted.length >= 2 && words.length > 1 && words.map((word) => word[0]).join('') === wanted) return true;
  }
  return false;
}

// ── Labels ─────────────────────────────────────────────────────────────────────────────────

/**
 * How a place is titled. Compact: 'Gadigal Country · Sydney, AU' (PS is spelled 'Palestine').
 * Wide: 'Gadigal Country · Sydney, New South Wales, Australia'. Approximate places start '≈ '.
 */
export function placeLabel(place: Place, style: 'compact' | 'wide'): string {
  const head = place.knownAs ? `${place.name} · ${place.knownAs}` : place.name;
  const seen = new Set([normaliseQuery(place.name), normaliseQuery(place.knownAs ?? '')]);
  const parts = [head];
  const add = (part: string | undefined): void => {
    if (!part) return;
    const key = normaliseQuery(part);
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(part);
  };
  if (style === 'wide') {
    add(place.region);
    add(place.country ?? place.countryCode);
  } else {
    add(place.countryCode === PS ? countryLabel(PS) : place.countryCode ?? place.country);
  }
  return `${place.approximate ? '≈ ' : ''}${parts.join(', ')}`;
}

// ── Suggestions ────────────────────────────────────────────────────────────────────────────

/** The optimal string alignment distance: edits, with a swap of neighbours counting as one. */
export function editDistance(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  const rows: number[][] = [];
  for (let i = 0; i <= s.length; i += 1) {
    const row: number[] = [i];
    for (let j = 1; j <= t.length; j += 1) row.push(i === 0 ? j : 0);
    rows.push(row);
  }
  const at = (i: number, j: number): number => rows[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= s.length; i += 1) {
    const row = rows[i] as number[];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      row[j] = best;
    }
  }
  return at(s.length, t.length);
}

/** The largest edit distance a suggestion may be from what was typed. */
export const SUGGEST_MAX_DISTANCE = 2;

/**
 * Curated names (and any `extra` names, such as recent places) within two edits of the query,
 * closest first. Returns canonical spellings: 'aoteroa' suggests 'Aotearoa'.
 */
export function suggestNames(query: string, extra: readonly string[] = [], max = 3): string[] {
  const wanted = normaliseQuery(query);
  if (wanted.length < 2) return [];
  const best = new Map<string, number>();
  const consider = (display: string, key: string): void => {
    const distance = editDistance(wanted, normaliseQuery(key));
    if (distance === 0 || distance > SUGGEST_MAX_DISTANCE) return;
    best.set(display, Math.min(distance, best.get(display) ?? Number.POSITIVE_INFINITY));
  };
  for (const entry of CURATED) {
    const display = entry.keys[0] ?? entry.name;
    for (const key of entry.keys) consider(display, key);
  }
  for (const name of extra) consider(name, name);
  return [...best.entries()]
    .sort(([a, da], [b, db]) => da - db || a.localeCompare(b))
    .slice(0, max)
    .map(([name]) => name);
}
