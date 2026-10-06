import { describe, expect, it } from 'vitest';
import {
  CURATED, CURATED_NAMES, countryCodeFor, countryLabel, editDistance, lookupCurated, matchesQualifier, normaliseQuery,
  placeLabel, suggestNames,
} from './places';
import type { Place } from './types';

/** The keys of the legacy table in src/utils/commands/network.ts, exactly as written there. */
const LEGACY_PALESTINE_KEYS = [
  'palestine', 'gaza', 'west+bank', 'westbank', 'ramallah', 'bethlehem', 'hebron', 'nablus', 'jenin', 'tulkarm',
  'qalqilya', 'jericho', 'khan+younis', 'rafah',
];

const mustFind = (query: string, qualifier?: string): Place => {
  const place = lookupCurated(query, qualifier);
  if (!place) throw new Error(`no curated place for ${query}`);
  return place;
};

describe('the curated table', () => {
  it('has unique keys after normalising and points in range', () => {
    const seen = new Map<string, string>();
    for (const entry of CURATED) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(Math.abs(entry.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(entry.lon)).toBeLessThanOrEqual(180);
      for (const key of entry.keys) {
        const normalised = normaliseQuery(key);
        expect(seen.get(normalised), `${key} duplicates ${seen.get(normalised)}`).toBeUndefined();
        seen.set(normalised, key);
      }
    }
  });

  it.each(LEGACY_PALESTINE_KEYS)('resolves the legacy key %s to Palestine', (key) => {
    const place = mustFind(key);
    expect(place.countryCode).toBe('PS');
    expect(place.country).toBe('Palestine');
    expect(place.source).toBe('curated');
    expect(placeLabel(place, 'wide')).toMatch(/Palestine$/);
    expect(placeLabel(place, 'compact')).toMatch(/Palestine/);
  });

  it.each([
    ['khan yunis', 'Khan Younis'],
    ['Khan-Yunus', 'Khan Younis'],
    ['west bank', 'West Bank'],
    ['WESTBANK', 'West Bank'],
    ['Al-Khalil', 'Hebron'],
    ['qalqilyah', 'Qalqilya'],
    ['gaza city', 'Gaza'],
    ['Occupied Palestinian Territories', 'Palestine'],
  ])('accepts the spelling %s', (query, name) => {
    expect(mustFind(query).name).toBe(name);
  });

  it('labels Palestine places as the owner intends', () => {
    expect(placeLabel(mustFind('gaza'), 'wide')).toBe('Gaza, Gaza Strip, Palestine');
    expect(placeLabel(mustFind('gaza'), 'compact')).toBe('Gaza, Palestine');
    expect(placeLabel(mustFind('westbank'), 'wide')).toBe('West Bank · Ramallah, Palestine');
    expect(placeLabel(mustFind('palestine'), 'wide')).toBe('Palestine');
    expect(mustFind('palestine').kind).toBe('country');
  });

  it('resolves Gadigal to Gadigal Country · Sydney', () => {
    const place = mustFind('Gadigal');
    expect(place).toMatchObject({ lat: -33.8688, lon: 151.2093, countryCode: 'AU', country: 'Australia' });
    expect(placeLabel(place, 'compact')).toBe('Gadigal Country · Sydney, AU');
    expect(placeLabel(place, 'wide')).toBe('Gadigal Country · Sydney, New South Wales, Australia');
  });

  it('resolves Aotearoa to Aotearoa · Wellington', () => {
    const place = mustFind('aotearoa');
    expect(place).toMatchObject({ lat: -41.2866, lon: 174.7756, countryCode: 'NZ' });
    expect(placeLabel(place, 'compact')).toBe('Aotearoa · Wellington, NZ');
    expect(placeLabel(place, 'wide')).toBe('Aotearoa · Wellington, New Zealand');
  });

  it.each([
    ['Naarm', 'Melbourne'],
    ['Meanjin', 'Brisbane'],
    ['Boorloo', 'Perth'],
    ['Tarntanya', 'Adelaide'],
    ['nipaluna', 'Hobart'],
    ['Garramilla', 'Darwin'],
    ['Tāmaki Makaurau', 'Auckland'],
    ['Tamaki-Makaurau', 'Auckland'],
    ['tamaki makaurau', 'Auckland'],
    ['Te Whanganui-a-Tara', 'Wellington'],
    ['te whanganui a tara', 'Wellington'],
    ['Ōtautahi', 'Christchurch'],
    ['otautahi', 'Christchurch'],
    ['Ōtepoti', 'Dunedin'],
    ['Kirikiriroa', 'Hamilton'],
  ])('resolves %s to %s', (query, knownAs) => {
    expect(mustFind(query).knownAs).toBe(knownAs);
  });

  it('keeps the display spelling, diacritics included', () => {
    expect(placeLabel(mustFind('otautahi'), 'compact')).toBe('Ōtautahi · Christchurch, NZ');
    expect(mustFind('NIPALUNA').name).toBe('nipaluna');
    expect(CURATED_NAMES).toContain('Tāmaki Makaurau');
    expect(CURATED_NAMES).toContain('Gadigal');
  });

  it('checks a qualifier against the entry', () => {
    expect(mustFind('Gaza', 'Palestine').name).toBe('Gaza');
    expect(mustFind('Gaza', 'PS').name).toBe('Gaza');
    expect(mustFind('Gadigal', 'NSW').name).toBe('Gadigal Country');
    expect(mustFind('Gadigal', 'Sydney').name).toBe('Gadigal Country');
    expect(lookupCurated('Hebron', 'Kentucky')).toBeUndefined();
    expect(lookupCurated('Rafah', 'Egypt')).toBeUndefined();
  });

  it('treats trailing words as a qualifier when they agree', () => {
    expect(mustFind('gaza palestine').name).toBe('Gaza');
    expect(mustFind('khan younis gaza').name).toBe('Khan Younis');
    expect(mustFind('naarm victoria').name).toBe('Naarm');
    expect(lookupCurated('hebron kentucky')).toBeUndefined();
    expect(lookupCurated('oslo')).toBeUndefined();
  });
});

describe('normaliseQuery', () => {
  it('ignores case, diacritics and apostrophes, and treats + _ - as spaces', () => {
    expect(normaliseQuery('Tāmaki-Makaurau')).toBe('tamaki makaurau');
    expect(normaliseQuery('khan+younis')).toBe('khan younis');
    expect(normaliseQuery('  West_Bank  ')).toBe('west bank');
    expect(normaliseQuery('Ōtautahi')).toBe('otautahi');
    expect(normaliseQuery("Hawai'i")).toBe('hawaii');
    expect(normaliseQuery('Hawaiʻi')).toBe('hawaii');
    expect(normaliseQuery('São Paulo')).toBe('sao paulo');
    expect(normaliseQuery('Te  Whanganui–a–Tara')).toBe('te whanganui a tara');
  });
});

describe('countries', () => {
  it('always labels PS as Palestine', () => {
    expect(countryLabel('PS')).toBe('Palestine');
    expect(countryLabel('ps', 'Palestinian Territories')).toBe('Palestine');
    expect(countryLabel('PS', null)).toBe('Palestine');
  });

  it('uses English names, then the provider name, then the code', () => {
    expect(countryLabel('NO')).toBe('Norway');
    expect(countryLabel('nz')).toBe('New Zealand');
    expect(countryLabel(undefined, 'Somewhere')).toBe('Somewhere');
    expect(countryLabel('XK', null)).toBe('Kosovo');
    expect(countryLabel(undefined)).toBeUndefined();
  });

  it('reads country names and codes', () => {
    expect(countryCodeFor('France')).toBe('FR');
    expect(countryCodeFor('fr')).toBe('FR');
    expect(countryCodeFor('United States')).toBe('US');
    expect(countryCodeFor('USA')).toBe('US');
    expect(countryCodeFor('uk')).toBe('GB');
    expect(countryCodeFor('New Zealand')).toBe('NZ');
    expect(countryCodeFor('Aotearoa')).toBe('NZ');
    expect(countryCodeFor('Palestine')).toBe('PS');
    expect(countryCodeFor('Illinois')).toBeUndefined();
    expect(countryCodeFor('zz')).toBeUndefined();
    expect(countryCodeFor('')).toBeUndefined();
  });
});

describe('matchesQualifier', () => {
  const springfield = { countryCode: 'US', country: 'United States', region: 'Illinois', district: 'Sangamon' };
  const perth = { countryCode: 'AU', country: 'Australia', region: 'Western Australia' };

  it('matches a country, a region prefix, a district or initials', () => {
    expect(matchesQualifier(springfield, 'US')).toBe(true);
    expect(matchesQualifier(springfield, 'United States')).toBe(true);
    expect(matchesQualifier(springfield, 'Illinois')).toBe(true);
    // IL is also Israel's code; the region prefix still matches.
    expect(matchesQualifier(springfield, 'IL')).toBe(true);
    expect(matchesQualifier(springfield, 'Sangamon')).toBe(true);
    expect(matchesQualifier(perth, 'WA')).toBe(true);
    expect(matchesQualifier(perth, 'AU')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(matchesQualifier(springfield, 'Massachusetts')).toBe(false);
    expect(matchesQualifier(springfield, 'France')).toBe(false);
    expect(matchesQualifier(perth, 'Scotland')).toBe(false);
    expect(matchesQualifier(perth, 'w')).toBe(false);
  });
});

describe('placeLabel', () => {
  it('marks approximate places and drops repeated parts', () => {
    const place: Place = {
      id: 'ip', name: 'Sydney', region: 'New South Wales', countryCode: 'AU', country: 'Australia',
      lat: -33.87, lon: 151.2, kind: 'city', source: 'ip', approximate: true,
    };
    expect(placeLabel(place, 'compact')).toBe('≈ Sydney, AU');
    expect(placeLabel(place, 'wide')).toBe('≈ Sydney, New South Wales, Australia');
    const singapore: Place = { id: 'x', name: 'Singapore', region: 'Singapore', countryCode: 'SG', country: 'Singapore', lat: 1.29, lon: 103.85, kind: 'city', source: 'open-meteo' };
    expect(placeLabel(singapore, 'wide')).toBe('Singapore');
    expect(placeLabel(singapore, 'compact')).toBe('Singapore, SG');
  });
});

describe('suggestions', () => {
  it('measures edits, counting a swap of neighbours as one', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('ab', 'ba')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('naarm', 'naarm')).toBe(0);
  });

  it('suggests curated names within two edits, canonical spelling first', () => {
    expect(suggestNames('aoteroa')).toEqual(['Aotearoa']);
    expect(suggestNames('Gadigl')).toEqual(['Gadigal']);
    expect(suggestNames('ramalah')).toEqual(['Ramallah']);
    expect(suggestNames('khan yonis')).toEqual(['Khan Younis']);
    expect(suggestNames('meajnin')).toEqual(['Meanjin']);
    expect(suggestNames('Atlantis')).toEqual([]);
    expect(suggestNames('x')).toEqual([]);
  });

  it('includes extra names such as recent places', () => {
    expect(suggestNames('Olso', ['Oslo'])).toEqual(['Oslo']);
  });
});
