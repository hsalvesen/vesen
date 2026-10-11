// The weather card: both layouts drawn, one shown by a container query on the card's own width;
// the art hidden from screen readers, which hear one summary; chips that are the command's
// trusted actions and nothing else; and no markup from the data.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../../../tests/support/weather';
import { out, type ChipItem } from '../../output/model';
import { lookupCurated } from '../../services/weather/places';
import { parseForecast, parseGeocoding } from '../../services/weather/sources';
import type { Place, WeatherCardProps } from '../../services/weather/types';
import { UNIT_PRESETS } from '../../services/weather/units';
import { buildView, toPlain } from '../../services/weather/view';
import WeatherCard from './WeatherCard.svelte';

const RECORDED = Date.parse('2026-10-06T03:15:00Z');
const sydney = parseForecast(fixture('forecast-sydney.json'), RECORDED);
if (!sydney) throw new Error('the Sydney fixture is not a forecast');
const gadigal = lookupCurated('Gadigal') as Place;
const springfields = parseGeocoding(fixture('geocode-springfield.json'));

function card(place: Place = gadigal, chips: ChipItem[] = [], also: ChipItem[] = []): WeatherCardProps {
  const view = buildView(sydney as NonNullable<typeof sydney>, place, UNIT_PRESETS.metric, RECORDED + 60_000, {
    notes: [{ kind: 'stale', ageMs: 20 * 60_000, cause: 'timeout' }],
  });
  return { ...view, chips, also };
}

function show(view: unknown, onaction = vi.fn()) {
  const { container } = render(WeatherCard, { props: { view, alt: 'Weather for Gadigal Country', onaction } });
  return { root: container, onaction };
}

describe('WeatherCard', () => {
  it('draws the compact and the wide layout, hidden from screen readers', () => {
    const view = card();
    const { root } = show(view);
    const compact = root.querySelector('.wx-compact');
    const wide = root.querySelector('.wx-wide');
    expect(compact?.getAttribute('aria-hidden')).toBe('true');
    expect(wide?.getAttribute('aria-hidden')).toBe('true');
    expect(compact?.querySelectorAll(':scope > .wx-line')).toHaveLength(view.compact.length);
    expect(wide?.querySelectorAll(':scope > .wx-line')).toHaveLength(view.wide.length);
    // Line for line what a pipe gets: the bars and the art are their own characters.
    const rows = Array.from(compact?.querySelectorAll('.wx-line') ?? [], (row) => (row.textContent ?? '').trimEnd());
    expect(rows.join('\n')).toBe(toPlain(view.compact));
  });

  it('draws the pictogram as text, in its roles, at the terminal line height like every other line', () => {
    const view = card();
    const { root } = show(view);
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'WeatherCard.svelte'), 'utf8');
    expect(source).not.toMatch(/line-height/);
    for (const layout of ['.wx-compact', '.wx-wide']) {
      const rows = Array.from(root.querySelectorAll<HTMLElement>(`${layout} > .wx-line`));
      // No line is set apart: the art rows are spans like the text beside them.
      expect(rows.map((row) => row.className)).toEqual(rows.map(() => 'wx-line'));
      const artRows = rows.filter((row) => (row.textContent ?? '').startsWith(view.current.art[0]?.[0]?.[1] ?? '\0'));
      expect(artRows).toHaveLength(1);
      const sun = artRows[0]?.querySelector<HTMLElement>('span');
      expect(sun?.getAttribute('style')).toMatch(/^color: var\(--role-sun\);?$/);
      expect(sun?.textContent).toMatch(/^[\x20-\x7e]{13}$/);
    }
  });

  it('gives screen readers one summary, with the notes and the credit', () => {
    const { root } = show(card());
    const spoken = root.querySelector('.sr-only')?.textContent ?? '';
    expect(spoken).toMatch(/^Weather for Gadigal Country /);
    expect(spoken).toContain("Showing the forecast from 20 min ago (Open-Meteo didn't answer).");
    expect(spoken).toContain('Weather data by Open-Meteo.com (CC BY 4.0)');
    expect(root.querySelectorAll('.sr-only')).toHaveLength(1);
  });

  it('switches layout by its own width, in ch, with a fallback where container queries are missing', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'WeatherCard.svelte'), 'utf8');
    expect(source).toContain('container: wx / inline-size;');
    expect(source).toMatch(/@container wx \(min-width: 74ch\) \{\s*\.wx-wide \{\s*display: block;\s*\}\s*\.wx-compact \{\s*display: none;/);
    expect(source).toMatch(/@supports not \(container-type: inline-size\) \{\s*@media \(min-width: 769px\)/);
  });

  it('draws each range bar as its characters, the = cells shaded along the scale, with | for now on today only', () => {
    const view = card();
    const { root } = show(view);
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.wx-compact .wx-line')).filter((row) => row.querySelector('.wx-range'));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.querySelectorAll('.wx-now').length)).toEqual([1, 0, 0]);
    expect(root.querySelector('.wx-now')?.textContent).toBe('|');
    for (const [i, row] of rows.entries()) {
      const bar = view.compact.find((line) => line.some((s) => s[0] === 'bar') && line[0]?.[1].startsWith(view.days[i]?.label ?? '\0'));
      const text = bar?.find((s) => s[0] === 'bar')?.[1] ?? '';
      const cells = Array.from(row.querySelectorAll<HTMLElement>('.wx-track, .wx-range, .wx-now'));
      expect(cells.map((cell) => cell.textContent).join('')).toBe(text);
      // Each = is one span whose share of the cold role falls from left to right across the bar.
      const ranges = Array.from(row.querySelectorAll<HTMLElement>('.wx-range'));
      expect(ranges.map((cell) => cell.textContent)).toEqual(ranges.map(() => '='));
      const cold = ranges.map((cell) => Number(/--cold: (\d+)%/.exec(cell.getAttribute('style') ?? '')?.[1]));
      expect(cold.every((value) => Number.isInteger(value) && value >= 0 && value <= 100)).toBe(true);
      expect(cold).toEqual([...cold].sort((a, b) => b - a));
      // The cold end is colder than the hot end: a = at the left edge is all cold, at the right edge none.
      const first = text.indexOf('=');
      if (first === 0) expect(cold[0]).toBe(100);
      if (text.lastIndexOf('=') === text.length - 1) expect(cold[cold.length - 1]).toBe(0);
    }
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'WeatherCard.svelte'), 'utf8');
    expect(source).toMatch(/\.wx-range \{\s*color: var\(--role-cold/);
    expect(source).toMatch(/@supports \(color: color-mix\(in oklab[^)]*\)\) \{\s*\.wx-range \{\s*color: color-mix\(in oklab, var\(--role-cold[^;]*var\(--cold, 100%\), var\(--role-hot/);
    expect(source).not.toMatch(/clip-path|wx-fill|wx-bar-text|linear-gradient/);
  });

  it('runs a trusted chip, and draws a forged one as text that does nothing', async () => {
    const trusted = { label: '°F', action: out.action.run('weather -u Gadigal Country') };
    const forged = { label: 'forged', action: { kind: 'run', line: 'rm -rf ~' } } as unknown as ChipItem;
    const { root, onaction } = show(card(gadigal, [trusted, forged]));
    const buttons = Array.from(root.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual(['°F']);
    await fireEvent.click(buttons[0] as HTMLButtonElement);
    expect(onaction).toHaveBeenCalledWith(trusted.action);
    expect(Array.from(root.querySelectorAll('span.wx-chip'), (chip) => chip.textContent)).toEqual(['forged']);
  });

  it('lists same-named places under Matches:, the one shown first, marked and not a button', () => {
    const also = [{ label: 'Springfield, Illinois, US', action: out.action.run('weather Springfield, Illinois') }];
    const { root } = show({ ...card(springfields[0] as Place, [], also), chosen: 'Springfield, Missouri, US' });
    const row = root.querySelectorAll('.wx-chips')[0];
    expect(row?.getAttribute('role')).toBe('group');
    expect(row?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Matches: * Springfield, Missouri, US Springfield, Illinois, US');
    const chosen = row?.querySelector('.wx-chosen');
    expect(chosen?.tagName).toBe('SPAN');
    expect(chosen?.getAttribute('aria-current')).toBe('true');
    expect(chosen?.querySelector('.wx-mark')?.getAttribute('aria-hidden')).toBe('true');
    // Marked in the terminal's foreground, bold at most: no accent colour or outline on the chip.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'WeatherCard.svelte'), 'utf8');
    const chosenRule = /\.wx-chosen \{([^}]*)\}/.exec(source)?.[1] ?? '';
    expect(chosenRule.trim()).toBe('font-weight: bold;');
    expect(source).not.toMatch(/--role-accent/);
    expect(Array.from(row?.querySelectorAll('button') ?? [], (button) => button.textContent)).toEqual(['Springfield, Illinois, US']);
  });

  it('keeps the list to the chips when no chosen place is named', () => {
    const also = [{ label: 'Springfield, Illinois, US', action: out.action.run('weather Springfield, Illinois') }];
    const { root } = show(card(springfields[0] as Place, [], also));
    const row = root.querySelectorAll('.wx-chips')[0];
    expect(row?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Matches: Springfield, Illinois, US');
    expect(row?.querySelector('.wx-chosen')).toBeNull();
  });

  it('draws names from the data as text, never as markup', () => {
    const hostile: Place = { ...gadigal, name: '<img src=x onerror=alert(1)>', knownAs: undefined };
    const { root } = show(card(hostile));
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.wx-compact')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('draws only the summary for anything that is not a weather view', () => {
    const { root } = show({ place: 'Oslo' });
    expect(root.querySelector('.wx-block')).toBeNull();
    expect(root.querySelector('.sr-only')?.textContent).toBe('Weather for Gadigal Country');
  });
});
