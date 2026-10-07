import { describe, expect, it } from 'vitest';
import { KEY_ROWS, keyHelp, showChord } from '../keys';
import { BINDINGS, chordOf, isModifierKey, resolveKey, type Action, type KeyChord, type KeyCtx, type KeyPlatform } from './keymap';

/** A key press: `C-a`, `M-b`, `S-Tab`, `Up`, a plain `x`. */
function press(chord: string, extra: Partial<KeyChord> = {}): KeyChord {
  let rest = chord;
  const take = (prefix: string): boolean => {
    if (!rest.startsWith(prefix)) return false;
    rest = rest.slice(prefix.length);
    return true;
  };
  const metaKey = take('Cmd-');
  const ctrlKey = take('C-');
  const altKey = take('M-');
  const shiftKey = take('S-');
  const named: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
  const key = named[rest] ?? rest;
  const code = /^[a-z]$/.test(rest) ? `Key${rest.toUpperCase()}` : rest === '.' ? 'Period' : key;
  return { key, code, ctrlKey, altKey, metaKey, shiftKey, isComposing: false, keyCode: 0, ...extra };
}

const EDIT: KeyCtx = {
  mode: 'edit',
  platform: 'other',
  atEnd: true,
  empty: false,
  hasGhost: false,
  hasSelection: false,
  escArmed: false,
};

function action(chord: string, ctx: Partial<KeyCtx> = {}, extra: Partial<KeyChord> = {}): Action {
  return resolveKey(press(chord, extra), { ...EDIT, ...ctx });
}

describe('every platform', () => {
  it.each<[string, Action]>([
    ['Enter', { a: 'submit' }],
    ['Tab', { a: 'tab', reverse: false }],
    ['S-Tab', { a: 'tab', reverse: true }],
    ['C-a', { a: 'op', op: 'bol' }],
    ['Home', { a: 'op', op: 'bol' }],
    ['C-e', { a: 'op', op: 'eol' }],
    ['End', { a: 'op', op: 'eol' }],
    ['C-u', { a: 'op', op: 'killToStart' }],
    ['C-k', { a: 'op', op: 'killToEnd' }],
    ['C-y', { a: 'op', op: 'yank' }],
    ['M-y', { a: 'op', op: 'yankPop' }],
    ['M-b', { a: 'op', op: 'wordLeft' }],
    ['M-Left', { a: 'op', op: 'wordLeft' }],
    ['M-f', { a: 'op', op: 'wordRight' }],
    ['M-Right', { a: 'op', op: 'wordRight' }],
    ['M-d', { a: 'op', op: 'killWordFwd' }],
    ['M-Backspace', { a: 'op', op: 'killWordBackAlnum' }],
    ['M-.', { a: 'yankLastArg' }],
    ['C-d', { a: 'op', op: 'deleteChar' }],
    ['C-l', { a: 'clearScreen' }],
    ['C-r', { a: 'search', dir: -1 }],
    ['C-c', { a: 'interrupt' }],
    ['Escape', { a: 'escape' }],
    ['Up', { a: 'history', dir: -1 }],
    ['Down', { a: 'history', dir: 1 }],
  ])('%s', (chord, expected) => {
    for (const platform of ['mac', 'other'] as const) expect(action(chord, { platform }), platform).toEqual(expected);
  });

  it('leaves plain typing, arrows and Backspace to the input', () => {
    for (const chord of ['a', 'Left', 'Right', 'Backspace', 'Delete', 'S-Left', ' ']) expect(action(chord)).toEqual({ a: 'native' });
  });
});

describe('platform differences', () => {
  const both = (chord: string): Record<KeyPlatform, Action> => ({ mac: action(chord, { platform: 'mac' }), other: action(chord, { platform: 'other' }) });

  it('binds Ctrl+W, P, N, B, F and T on a Mac only, where the browser does not need them', () => {
    expect(both('C-w')).toEqual({ mac: { a: 'op', op: 'killWordBackUnix' }, other: { a: 'native' } });
    expect(both('C-p')).toEqual({ mac: { a: 'history', dir: -1 }, other: { a: 'native' } });
    expect(both('C-n')).toEqual({ mac: { a: 'history', dir: 1 }, other: { a: 'native' } });
    expect(both('C-b')).toEqual({ mac: { a: 'op', op: 'charLeft' }, other: { a: 'native' } });
    expect(both('C-f')).toEqual({ mac: { a: 'op', op: 'charRight' }, other: { a: 'native' } });
    expect(both('C-t')).toEqual({ mac: { a: 'op', op: 'transpose' }, other: { a: 'native' } });
  });

  it('cuts a word with Ctrl+Backspace off a Mac, and Alt+Backspace everywhere', () => {
    expect(both('C-Backspace')).toEqual({ mac: { a: 'native' }, other: { a: 'op', op: 'killWordBackAlnum' } });
    expect(both('M-Backspace')).toEqual({ mac: { a: 'op', op: 'killWordBackAlnum' }, other: { a: 'op', op: 'killWordBackAlnum' } });
  });

  it('reads Option+B on a Mac by its key, though it types ∫', () => {
    expect(resolveKey(press('M-b', { key: '∫' }), { ...EDIT, platform: 'mac' })).toEqual({ a: 'op', op: 'wordLeft' });
    expect(resolveKey(press('M-.', { key: '≥' }), { ...EDIT, platform: 'mac' })).toEqual({ a: 'yankLastArg' });
  });

  it('reads Ctrl+R by its key on any layout', () => {
    expect(resolveKey(press('C-r', { key: 'к' }), EDIT)).toEqual({ a: 'search', dir: -1 });
  });

  it('leaves Cmd shortcuts, Ctrl+Shift chords and AltGr characters to the browser', () => {
    expect(action('Cmd-c', { platform: 'mac' })).toEqual({ a: 'native' });
    expect(action('Cmd-a', { platform: 'mac' })).toEqual({ a: 'native' });
    expect(action('C-S-r')).toEqual({ a: 'native' });
    expect(resolveKey(press('C-M-q', { key: '@' }), EDIT)).toEqual({ a: 'native' });
  });
});

describe('keys an input method is composing', () => {
  it('are left to it', () => {
    expect(action('Enter', {}, { isComposing: true })).toEqual({ a: 'native' });
    expect(action('Tab', {}, { keyCode: 229 })).toEqual({ a: 'native' });
    expect(action('C-u', {}, { key: 'Process', keyCode: 229 })).toEqual({ a: 'native' });
  });
});

describe('what depends on the moment', () => {
  it('Ctrl+C copies when text is selected, except on a Mac, where Cmd+C copies and Ctrl+C always interrupts', () => {
    expect(action('C-c', { hasSelection: true })).toEqual({ a: 'native' });
    expect(action('C-c', { hasSelection: false })).toEqual({ a: 'interrupt' });
    expect(action('C-c', { hasSelection: true, platform: 'mac' })).toEqual({ a: 'interrupt' });
    expect(action('C-c', { hasSelection: false, platform: 'mac' })).toEqual({ a: 'interrupt' });
  });

  it('Ctrl+D on an empty line is end of input', () => {
    expect(action('C-d', { empty: true })).toEqual({ a: 'eof' });
    expect(action('C-d', { empty: false })).toEqual({ a: 'op', op: 'deleteChar' });
  });

  it('Right, End and Ctrl+E take the grey suggestion only at the end of the line', () => {
    for (const chord of ['Right', 'End', 'C-e']) expect(action(chord, { hasGhost: true, atEnd: true })).toEqual({ a: 'acceptGhost', unit: 'all' });
    expect(action('Right', { hasGhost: true, atEnd: false })).toEqual({ a: 'native' });
    expect(action('End', { hasGhost: false })).toEqual({ a: 'op', op: 'eol' });
    expect(action('M-f', { hasGhost: true })).toEqual({ a: 'acceptGhost', unit: 'word' });
    expect(action('M-Right', { hasGhost: true })).toEqual({ a: 'acceptGhost', unit: 'word' });
    expect(action('C-f', { hasGhost: true, platform: 'mac' })).toEqual({ a: 'acceptGhost', unit: 'all' });
    expect(action('Right', { hasGhost: true, mode: 'busy' })).toEqual({ a: 'native' });
  });

  it('Escape then Tab within the second leaves the terminal, Shift+Tab too', () => {
    expect(action('Tab', { escArmed: true })).toEqual({ a: 'leave' });
    expect(action('S-Tab', { escArmed: true })).toEqual({ a: 'leave' });
    expect(action('Tab', { escArmed: false })).toEqual({ a: 'tab', reverse: false });
  });

  it('Shift and the other modifiers never disarm it', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) expect(isModifierKey(key)).toBe(true);
    expect(isModifierKey('a')).toBe(false);
  });
});

describe('reverse-i-search', () => {
  const search: Partial<KeyCtx> = { mode: 'search' };

  it('Ctrl+R older, Ctrl+S newer, Enter runs, Escape and Ctrl+G cancel', () => {
    expect(action('C-r', search)).toEqual({ a: 'search', dir: -1 });
    expect(action('C-s', search)).toEqual({ a: 'search', dir: 1 });
    expect(action('Enter', search)).toEqual({ a: 'searchAccept' });
    expect(action('Escape', search)).toEqual({ a: 'searchCancel' });
    expect(action('C-g', search)).toEqual({ a: 'searchCancel' });
  });

  it('moving keys put the line found on the prompt', () => {
    for (const chord of ['Left', 'Right', 'Up', 'Down', 'Home', 'End', 'C-a', 'C-e', 'Tab', 'C-j']) expect(action(chord, search), chord).toEqual({ a: 'searchExit' });
    expect(action('C-b', { ...search, platform: 'mac' })).toEqual({ a: 'searchExit' });
  });

  it('cutting and pasting keys end the search too, and act on the line found, as in readline', () => {
    for (const chord of ['C-k', 'C-u', 'C-y', 'C-d', 'C-l', 'M-d', 'M-Backspace', 'M-.']) expect(action(chord, search), chord).toEqual({ a: 'searchExit' });
    expect(action('C-Backspace', search)).toEqual({ a: 'searchExit' });
    for (const chord of ['C-w', 'C-t']) {
      expect(action(chord, { ...search, platform: 'mac' }), chord).toEqual({ a: 'searchExit' });
      expect(action(chord, search), chord).toEqual({ a: 'native' });
    }
  });

  it('typing and Backspace edit the query; Ctrl+C still interrupts', () => {
    expect(action('x', search)).toEqual({ a: 'native' });
    expect(action('Backspace', search)).toEqual({ a: 'native' });
    expect(action('C-c', search)).toEqual({ a: 'interrupt' });
  });

  it('Ctrl+S is the browser’s outside a search', () => {
    expect(action('C-s')).toEqual({ a: 'native' });
  });
});

describe('chords', () => {
  it('name a Ctrl or Alt letter by the letter the layout types', () => {
    // German QWERTZ: the key printed Y is where QWERTY has Z.
    expect(chordOf({ ...press('C-y'), code: 'KeyZ' })).toBe('C-y');
    expect(chordOf({ ...press('C-z'), code: 'KeyY' })).toBe('C-z');
    // French AZERTY: A is where QWERTY has Q, W where it has Z.
    expect(chordOf({ ...press('C-a'), code: 'KeyQ' })).toBe('C-a');
    expect(chordOf({ ...press('C-w'), code: 'KeyZ' })).toBe('C-w');
    expect(chordOf({ ...press('M-.'), code: 'Comma' })).toBe('M-.');
  });

  it('fall back to the physical key when the layout types something else', () => {
    // Option+B on a Mac types ∫; Ctrl+Ф on a Russian layout is the key QWERTY calls A.
    expect(chordOf({ ...press('M-b'), key: '∫' })).toBe('M-b');
    expect(chordOf({ ...press('M-.'), key: '≥' })).toBe('M-.');
    expect(chordOf({ ...press('C-a'), key: 'ф' })).toBe('C-a');
  });

  it('are written as readline writes them, and shown as people write them', () => {
    expect(chordOf(press('C-a'))).toBe('C-a');
    expect(chordOf(press('S-Tab'))).toBe('S-Tab');
    expect(chordOf({ ...press('a'), key: 'A', shiftKey: true })).toBe('a');
    expect(showChord('C-a')).toBe('Ctrl+A');
    expect(showChord('M-Left')).toBe('Alt+←');
    expect(showChord('S-Tab')).toBe('Shift+Tab');
    expect(showChord('M-.')).toBe('Alt+.');
  });
});

describe('help keys', () => {
  it('has a row for everything the table binds, with the Mac-only keys marked', () => {
    const rows = keyHelp();
    for (const { row } of BINDINGS) if (row !== undefined) expect(rows.some(({ does }) => does === KEY_ROWS[row].does), row).toBe(true);
    // Every row is used, and no two rows say the same.
    expect(new Set(rows.map((row) => row.does)).size).toBe(Object.keys(KEY_ROWS).length);
    expect(rows.find((row) => row.does === 'cut back to the last space')?.keys).toBe('Ctrl+W (Mac)');
    expect(rows.find((row) => row.does === 'clear the screen, keeping the line')?.keys).toBe('Ctrl+L');
    expect(rows[0]).toEqual({ keys: 'Enter', does: 'run the line' });
    expect(rows[rows.length - 1]).toEqual({ keys: 'Escape, Tab', does: 'leave the terminal for the rest of the page' });
  });

  it('lists only a platform’s own keys when asked for one', () => {
    const other = keyHelp('other').map((row) => row.keys);
    expect(other.join(' ')).not.toContain('(Mac)');
    expect(other).not.toContain('Ctrl+W');
    expect(keyHelp('mac').map((row) => row.keys)).toContain('Ctrl+W');
  });
});
