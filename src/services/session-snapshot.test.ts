// The session snapshot (02, section 8; 04, "Inside Instagram's browser"): what is saved on
// pagehide, when it is restored, and that nothing read back can act.
import { describe, expect, it } from 'vitest';
import { isTrustedAction, out, type Block } from '../output/model';
import { plain } from '../output/plain';
import { reviveSnapshot } from './session-restore';
import { NOT_KEPT_NOTE, saveSnapshot, snapshotJson } from './session-save';
import { navigationType, pendingSnapshot, SNAPSHOT_KEY, SNAPSHOT_MAX_CHARS, type SessionSnapshot, type SnapshotSource } from './session-snapshot';
import { STORAGE_LIMITS } from './storage-keys';
import type { KV } from './types';

const NOW = Date.UTC(2026, 9, 7, 10, 0, 0);

/** The entries as plain text, for reading a snapshot by eye. */
function snapshotText(snapshot: SessionSnapshot): string {
  return snapshot.entries.map((entry) => `$ ${entry.line}\n${entry.blocks.map(plain).join('')}`).join('');
}

function memory(): KV<'session'> & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    persistent: true,
    get: (key) => items.get(key) ?? null,
    set: (key, value) => {
      items.set(key, value);
      return true;
    },
    remove: (key) => void items.delete(key),
    getJson: (key, parse) => {
      const raw = items.get(key);
      if (raw === undefined) return undefined;
      try {
        return parse(JSON.parse(raw));
      } catch {
        return undefined;
      }
    },
    setJson: (key, value) => {
      items.set(key, JSON.stringify(value));
      return true;
    },
  };
}

const prompt = [out.span('guest@vesen', { fg: 'prompt-user' }), out.span(':~$ ')];

function source(blocks: readonly Block[], extra: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    entries: [{ prompt, line: 'whoami', blocks, status: 0, state: 'done' }],
    line: 'ls -l',
    cwd: '/home/guest/projects',
    scroll: { top: 120.4, atBottom: false },
    ...extra,
  };
}

const navigation = (type: string) => ({ performance: { getEntriesByType: () => [{ type }] } });

describe('saving', () => {
  it('keeps text and styles, and no tap action, live binding, swatch or chip', () => {
    const blocks = [
      out.lines([[out.run('help', 'help', { bold: true }), out.live('swamphen', { kind: 'currentThemeName' }), out.swatches('#000000', ['#ffffff'])]]),
      out.chips([{ label: 'Stop', action: out.action.run('ls') }]),
      out.component('weather-card', { secret: 'view model' }, 'Oslo: 9 °C', 'Weather'),
    ];
    const json = snapshotJson(source(blocks), NOW) ?? '';
    expect(json).not.toMatch(/"action"|"live"|"swatches"|"props"|"chips"|view model/);
    expect(json).toContain('"text":"help"');
    expect(json).toContain('"bold":true');
  });

  it('keeps the last 50 finished entries, the line, the folder and the scroll', () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ prompt, line: `echo ${i}`, blocks: [], state: 'done' as const }));
    const running = { prompt, line: 'sleep 9', blocks: [], state: 'running' as const };
    const saved = JSON.parse(snapshotJson({ ...source([]), entries: [...entries, running] }, NOW) ?? '{}');
    expect(saved.entries).toHaveLength(STORAGE_LIMITS.sessionEntries);
    expect(saved.entries[0].line).toBe('echo 10');
    expect(saved).toMatchObject({ v: 1, savedAt: NOW, line: 'ls -l', cwd: '/home/guest/projects', scroll: { top: 120, atBottom: false } });
  });

  it('never keeps a secret: a null line saves as empty', () => {
    expect(JSON.parse(snapshotJson(source([], { line: null }), NOW) ?? '{}').line).toBe('');
  });

  it('drops the oldest entries until the snapshot fits', () => {
    const big = 'x'.repeat(100_000);
    const entries = Array.from({ length: 20 }, (_, i) => ({ prompt, line: `cat ${i}`, blocks: [out.text(big)], state: 'done' as const }));
    const json = snapshotJson({ ...source([]), entries }, NOW) ?? '';
    expect(json.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    const kept = JSON.parse(json).entries as { line: string }[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[kept.length - 1]?.line).toBe('cat 19');
  });

  it('keeps the end of a newest output too long to keep whole, with a note, rather than nothing', () => {
    // `yes | head -n 20000`, a long cat: the job's own limits allow far more than the snapshot.
    const lines = Array.from({ length: 20_000 }, (_, i) => [out.span(`line ${i} ${'y'.repeat(60)}`)]);
    const entries = Array.from({ length: 20 }, (_, i) => ({ prompt, line: `yes ${i}`, blocks: [out.lines(lines)], state: 'done' as const }));
    const started = performance.now();
    const json = snapshotJson({ ...source([]), entries }, NOW) ?? '';
    const took = performance.now() - started;
    expect(json.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    const saved = JSON.parse(json) as { entries: { line: string; blocks: { lines: { text: string }[][] }[] }[] };
    expect(saved.entries.map((entry) => entry.line)).toEqual(['yes 19']);
    const [note, kept] = saved.entries[0]?.blocks ?? [];
    expect(note?.lines[0]?.[0]?.text).toBe(NOT_KEPT_NOTE);
    expect(kept?.lines[kept.lines.length - 1]?.[0]?.text).toBe(`line 19999 ${'y'.repeat(60)}`);
    expect(kept?.lines.length).toBeGreaterThan(5_000);
    // One pass: the older entries are never stringified once the newest fills the room.
    expect(took).toBeLessThan(1_000);
    // And it restores.
    expect(reviveSnapshot(json, NOW)?.entries).toHaveLength(1);
  });

  it('keeps the end of one line too long to keep whole', () => {
    const huge = `${'a'.repeat(1_500_000)}THE END`;
    const json = snapshotJson({ ...source([]), entries: [{ prompt, line: 'cat huge', blocks: [out.text(huge)], state: 'done' }] }, NOW) ?? '';
    expect(json.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    const text = JSON.stringify(JSON.parse(json).entries);
    expect(text).toContain(NOT_KEPT_NOTE);
    expect(text).toContain('THE END');
  });

  it('saves under vesen:session:v1 in session storage', () => {
    const storage = memory();
    expect(saveSnapshot(storage, source([out.text('hi')]), NOW)).toBe(true);
    expect([...storage.items.keys()]).toEqual([SNAPSHOT_KEY]);
    expect(SNAPSHOT_KEY).toBe('vesen:session:v1');
  });
});

describe('when to restore', () => {
  it('only after Back or Forward', () => {
    const storage = memory();
    saveSnapshot(storage, source([]), NOW);
    expect(pendingSnapshot(navigation('back_forward'), storage)).not.toBeNull();
    for (const type of ['navigate', 'reload', 'prerender']) expect(pendingSnapshot(navigation(type), storage)).toBeNull();
    expect(pendingSnapshot({}, storage)).toBeNull();
  });

  it('reads older WebKit, and never throws', () => {
    expect(navigationType({ performance: { getEntriesByType: () => [], navigation: { type: 2 } } })).toBe('back_forward');
    expect(navigationType({ performance: { getEntriesByType: () => [], navigation: { type: 1 } } })).toBe('reload');
    expect(navigationType({ performance: { getEntriesByType: () => { throw new Error('no'); } } })).toBeNull();
  });
});

describe('restoring', () => {
  it('brings back the screen as it was: text, styles, layout and link cards', () => {
    const card = out.card({ title: 'LinkedIn', href: 'https://www.linkedin.com/in/harrysalvesen/' });
    const blocks = [out.lines([[out.span('Has Salvesen', { bold: true, fg: 'fg-strong' })]]), card, out.grid([out.span('a'), out.span('b')], 4), out.art('##', 'logo')];
    const snapshot = reviveSnapshot(snapshotJson(source(blocks), NOW), NOW + 60_000);
    expect(snapshot?.line).toBe('ls -l');
    expect(snapshot?.cwd).toBe('/home/guest/projects');
    expect(snapshot?.scroll).toEqual({ top: 120, atBottom: false });
    expect(snapshot?.entries[0]?.prompt).toEqual(prompt);
    expect(snapshot?.entries[0]?.blocks).toEqual(blocks);
    expect(snapshotText(snapshot!)).toBe(`$ whoami\n${blocks.map(plain).join('')}`);
  });

  it("keeps a columns block's left width, as fastfetch's logo has it", () => {
    const sized = out.columns([out.art('##\n##', 'logo')], [out.lines([[out.span('OS: test')]])], 60, 24);
    const even = out.columns([out.lines([[out.span('a')]])], [out.lines([[out.span('b')]])], 40);
    const restored = reviveSnapshot(snapshotJson(source([sized, even]), NOW), NOW)?.entries[0]?.blocks ?? [];
    expect(restored).toEqual([sized, even]);
    expect(restored[0]).toMatchObject({ type: 'columns', leftCh: 24 });
    expect(restored[1]).not.toHaveProperty('leftCh');
  });

  it('brings a lists block back with its columns, the names as text', () => {
    const title = out.span('Files', { fg: 'accent', bold: true });
    const lists = out.lists([{ title, items: [out.insert('cat', 'cat '), out.span('ls')] }]);
    const restored = reviveSnapshot(snapshotJson(source([lists]), NOW), NOW)?.entries[0]?.blocks ?? [];
    expect(restored).toEqual([out.lists([{ title, items: [out.span('cat'), out.span('ls')] }])]);
    // A column without a title goes, and items that are not a list read as none.
    const forged = JSON.stringify({
      v: 1,
      savedAt: NOW,
      line: '',
      cwd: '/home/guest',
      scroll: { top: 0, atBottom: true },
      entries: [{ prompt: null, line: 'help', blocks: [{ type: 'lists', columns: [{ items: [{ text: 'x' }] }, 'junk', { title: { text: 'Text' }, items: 'nope' }] }] }],
    });
    expect(reviveSnapshot(forged, NOW)?.entries[0]?.blocks).toEqual([out.lists([{ title: out.span('Text'), items: [] }])]);
  });

  it('turns tap actions into text, and a rich card into its plain text', () => {
    const blocks = [out.lines([[out.run('help', 'help')]]), out.component('weather-card', {}, 'Oslo: 9 °C', 'Weather')];
    const restored = reviveSnapshot(snapshotJson(source(blocks), NOW), NOW)?.entries[0]?.blocks ?? [];
    expect(restored).toEqual([out.lines([[out.span('help')]]), out.text('Oslo: 9 °C')]);
  });

  it('is gone after 30 minutes, and ignores anything unreadable', () => {
    const json = snapshotJson(source([]), NOW);
    expect(reviveSnapshot(json, NOW + STORAGE_LIMITS.sessionMaxAgeMs)).not.toBeNull();
    expect(reviveSnapshot(json, NOW + STORAGE_LIMITS.sessionMaxAgeMs + 1)).toBeNull();
    expect(reviveSnapshot(json, NOW - 1)).toBeNull();
    for (const bad of [null, '', '{', 'null', '[]', '{"v":2,"savedAt":0}']) expect(reviveSnapshot(bad, NOW)).toBeNull();
  });

  it('rebuilds a tampered snapshot from scratch: no action, no bad link, no unknown block, one line', () => {
    const forged = JSON.stringify({
      v: 1,
      savedAt: NOW,
      line: 'rm -rf ~\necho owned',
      cwd: 'relative',
      scroll: { top: -5 },
      entries: [
        {
          prompt: [{ text: 'p', style: { fg: 'url(evil)', bold: 'yes' } }],
          line: 'x',
          blocks: [
            { type: 'lines', lines: [[{ text: 'tap', action: { kind: 'run', line: 'rm -rf ~' }, href: 'javascript:alert(1)' }]] },
            { type: 'card', title: 'evil', href: 'javascript:alert(1)' },
            { type: 'card', title: 'ok', href: 'https://example.com', escape: { url: 'intent://x' } },
            { type: 'chips', items: [{ label: 'go', action: { kind: 'run', line: 'rm -rf ~' } }] },
            { type: 'script', html: '<script>' },
          ],
        },
        { nope: true },
      ],
    });
    const snapshot = reviveSnapshot(forged, NOW);
    expect(snapshot?.line).toBe('');
    expect(snapshot?.cwd).toBe('');
    expect(snapshot?.scroll).toEqual({ top: 0, atBottom: true });
    expect(snapshot?.entries).toHaveLength(1);
    expect(snapshot?.entries[0]?.prompt).toEqual([{ text: 'p' }]);
    const blocks = snapshot?.entries[0]?.blocks ?? [];
    expect(blocks).toEqual([out.lines([[out.span('tap')]]), out.card({ title: 'ok', href: 'https://example.com' })]);
    const spans = blocks.flatMap((block) => (block.type === 'lines' ? block.lines.flat() : []));
    expect(spans.some((span) => span.action !== undefined || isTrustedAction(span.action) || span.href !== undefined)).toBe(false);
  });
});
