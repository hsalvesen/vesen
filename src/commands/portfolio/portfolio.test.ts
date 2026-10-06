// theme, cathode and banner as specs (F075, F030, F009): theme ls draws each theme's swatches in
// its own colours with a live marker on the current one, both remember the choice by name, and
// the banner is compact on a narrow terminal.
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { lineText, plain, type Block, type Line } from '../../output/model';
import { createStorage } from '../../services/storage';
import { STORAGE_KEYS } from '../../services/storage-keys';
import { cathode, cathodeQuality, crtTier, DEFAULT_CATHODE_MODE, persistCathode } from '../../stores/cathode';
import { defaultTheme, persistTheme, theme } from '../../stores/theme';
import { BANNER_ART, BANNER_ART_COMPACT } from '../lib/banner';

afterEach(() => {
  // The stores are the app's, shared by every session in this file.
  theme.set(defaultTheme);
  cathode.set(DEFAULT_CATHODE_MODE);
  cathodeQuality.set('auto');
});

const text = (blocks: readonly Block[]): string => blocks.map(plain).join('');
const rows = (blocks: readonly Block[]): readonly Line[] => blocks.flatMap((block) => (block.type === 'lines' ? block.lines : []));

describe('theme ls', () => {
  it('draws one row per theme: a live marker, the name as a tap, and eight swatches in its own hex', async () => {
    const { status, blocks } = await runLine('theme ls');
    expect(status).toBe(0);
    const themeRows = rows(blocks).filter((line) => line.some((span) => span.swatches !== undefined));
    expect(themeRows).toHaveLength(10);
    const swamphen = themeRows.find((line) => line[1]?.text === 'swamphen') ?? [];
    expect(swamphen[0]).toMatchObject({ text: '› ', live: { kind: 'isCurrentTheme', theme: 'swamphen', marker: '› ' } });
    expect(swamphen[1]).toMatchObject({ live: { kind: 'isCurrentTheme', theme: 'swamphen' }, action: { kind: 'run', line: 'theme set swamphen' } });
    expect(swamphen[3]?.swatches?.background).toBe('#222235');
    expect(swamphen[3]?.swatches?.colours).toHaveLength(8);
    expect(swamphen[3]?.swatches?.colours).toContain('#f60055');
    const wombat = themeRows.find((line) => line[1]?.text === 'wombat') ?? [];
    expect(wombat[0]?.text).toBe('  ');
    // No hex anywhere else: every other colour is a token.
    for (const line of rows(blocks)) for (const span of line) if (span.swatches === undefined) expect(JSON.stringify(span.style ?? {})).not.toMatch(/#/);
  });

  it('lists the names alone in a pipe', async () => {
    const { stdoutPlain } = await runLine('theme ls', { tty: false });
    expect(stdoutPlain.split('\n')).toEqual(['cassowary', 'cockatoo', 'crocodile', 'kangaroo', 'kookaburra', 'petroica', 'swamphen', 'treefrog', 'wallaby', 'wombat']);
  });
});

describe('theme set', () => {
  it('switches by name in any case, and confirms in one line', async () => {
    const s = await session();
    expect(await s.run('theme set WOMBAT')).toMatchObject({ status: 0, stdoutPlain: 'Theme set to wombat.' });
    expect(get(theme).name).toBe('wombat');
    expect(await s.run('theme Cockatoo')).toMatchObject({ status: 0, stdoutPlain: 'Theme set to cockatoo.' });
    expect(get(theme).name).toBe('cockatoo');
    s.stop();
  });

  it('says when there is no such theme, or no name', async () => {
    expect(await runLine('theme set nope')).toMatchObject({
      status: 1,
      stderrPlain: "theme: nope: no such theme\nTry 'theme ls' to see all available themes.",
    });
    expect(await runLine('theme nope')).toMatchObject({ status: 1 });
    expect(await runLine('theme set')).toMatchObject({ status: 2, stderrPlain: "theme: set: missing theme name\nTry 'theme --help' for more information." });
    expect(get(theme).name).toBe('swamphen');
  });

  it('shows its help with no arguments', async () => {
    expect((await runLine('theme')).stdoutPlain).toContain('theme - change the colour theme');
  });

  it('is remembered by name, and restored by name after a reload', async () => {
    const storage = createStorage(null).local;
    const stop = persistTheme(storage);
    await runLine('theme set wombat');
    expect(storage.get(STORAGE_KEYS.theme.key)).toBe('wombat');
    stop();
    // A reload: the default first, then the saved name.
    theme.set(defaultTheme);
    persistTheme(storage)();
    expect(get(theme).name).toBe('wombat');
  });
});

describe('cathode', () => {
  it('lists the variations with a live marker, and the tier in force and why', async () => {
    crtTier.set({ tier: 'lite', reason: 'a touch screen', quality: 'auto' });
    const { status, blocks } = await runLine('cathode ls');
    expect(status).toBe(0);
    const listing = text(blocks);
    expect(listing).toContain('› scanlines  Subtle horizontal scanlines');
    expect(listing).toContain('  vintage    The full retro set');
    expect(listing).toContain('Quality: lite (auto: a touch screen)');
    const vintage = rows(blocks).find((line) => line[1]?.text === 'vintage') ?? [];
    expect(vintage[0]?.live).toEqual({ kind: 'isCurrentCathode', mode: 'vintage', marker: '› ' });
    expect(vintage[1]?.action).toMatchObject({ kind: 'run', line: 'cathode set vintage' });
  });

  it('sets a variation, turns it off, and takes the name alone', async () => {
    const s = await session();
    expect(await s.run('cathode set VINTAGE')).toMatchObject({ status: 0, stdoutPlain: "Cathode effect set to vintage. Try 'cathode ls' to compare the variations." });
    expect(get(cathode)).toBe('vintage');
    expect(await s.run('cathode off')).toMatchObject({ status: 0, stdoutPlain: 'Cathode effect turned off.' });
    expect(await s.run('cathode phosphor')).toMatchObject({ status: 0 });
    expect(get(cathode)).toBe('phosphor');
    expect(await s.run('cathode set neon')).toMatchObject({ status: 1, stderrPlain: "cathode: neon: no such variation\nTry 'cathode ls' to see all available variations." });
    s.stop();
  });

  it('sets, reports and rejects a quality', async () => {
    // What bootstrap does when the quality changes.
    const stop = cathodeQuality.subscribe((quality) =>
      crtTier.set({ tier: quality === 'auto' ? 'full' : quality, reason: quality === 'auto' ? 'a desktop' : `set with cathode quality ${quality}`, quality }),
    );
    const s = await session();
    expect(await s.run('cathode quality lite')).toMatchObject({ status: 0, stdoutPlain: 'Cathode quality set to lite: lite (set with cathode quality lite).' });
    expect(get(cathodeQuality)).toBe('lite');
    expect((await s.run('cathode quality')).stdoutPlain).toBe('Cathode quality: lite (set with cathode quality lite)\nChange it with: cathode quality [auto|full|lite|off]');
    expect(await s.run('cathode quality AUTO')).toMatchObject({ stdoutPlain: 'Cathode quality set to auto: full (auto: a desktop).' });
    expect(await s.run('cathode quality ultra')).toMatchObject({
      status: 1,
      stderrPlain: 'cathode: quality: ultra: not a quality\nChoose one of: auto, full, lite, off.',
    });
    expect(get(cathodeQuality)).toBe('auto');
    s.stop();
    stop();
  });

  it('remembers the mode and quality by name', async () => {
    const storage = createStorage(null).local;
    const stop = persistCathode(storage);
    await runLine('cathode set vintage; cathode quality lite');
    expect(storage.getJson(STORAGE_KEYS.cathode.key, (raw) => raw)).toEqual({ mode: 'vintage', quality: 'lite' });
    stop();
    cathode.set(DEFAULT_CATHODE_MODE);
    cathodeQuality.set('auto');
    persistCathode(storage)();
    expect([get(cathode), get(cathodeQuality)]).toEqual(['vintage', 'lite']);
  });
});

describe('banner', () => {
  it('draws the logo as art with a description, then the meta, keys and first steps', async () => {
    const { status, blocks } = await runLine('banner', { cols: 80 });
    expect(status).toBe(0);
    expect(blocks[0]).toMatchObject({ type: 'art', text: BANNER_ART, alt: 'Vesen logo', fit: 'scale' });
    const lines = rows(blocks).map(lineText);
    expect(lines[0]).toMatch(/^vesen v.+ · a terminal by Has Salvesen$/);
    expect(lines[1]).toBe('Tab completes · ↑ history · help <cmd> for details');
    expect(lines).toContain('Type help to see all available commands.');
    const help = rows(blocks).flat().find((span) => span.text === 'help');
    expect(help?.action).toMatchObject({ kind: 'run', line: 'help' });
  });

  it('is compact under 50 columns', async () => {
    const { blocks } = await runLine('banner', { cols: 46 });
    expect(blocks[0]).toMatchObject({ type: 'art', text: BANNER_ART_COMPACT });
    expect(lineText(rows(blocks)[0] ?? [])).toMatch(/^vesen v.+ · by Has Salvesen$/);
    for (const row of BANNER_ART_COMPACT.split('\n')) expect(Array.from(row)).toHaveLength(26);
  });
});
