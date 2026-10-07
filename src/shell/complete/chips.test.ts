// The chips (designs/terminal-input.md, chips.ts): completions while typing, the list after Tab,
// starters on an empty touch line, did-you-mean after 127, Stop and Cancel. A chip edits the line
// exactly as choosing the same candidate in the Tab menu and pressing Enter does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, completionHarness, type CompletionHarness } from '../../testing/completion-env';
import { defineCommand, type CommandSpec } from '../types';
import { applyChip, chipsFor, readyToRun } from './chips';
import { complete } from './engine';
import { menuKey, pressTab } from './tab';
import { TAB_IDLE, type ChipInput, type CompletionEnv, type EditState, type TabState } from './types';

let h: CompletionHarness;
let env: CompletionEnv;

beforeAll(async () => {
  h = await completionHarness();
  env = h.env;
  h.app.vfs.writeFile('/home/guest/documents/my notes.txt', 'notes');
});
afterAll(() => h.stop());

function input(line: string, extra: Partial<ChipInput> = {}): ChipInput {
  const state = at(line);
  return { mode: 'edit', state, result: complete(state, env), tab: TAB_IDLE, touch: false, registry: env.registry, history: [], max: 12, ...extra };
}

describe('chipsFor', () => {
  it('offers the completions while typing, with the typed part marked and a count of the rest', () => {
    const { chips, more } = chipsFor(input('c', { max: 3 }));
    expect(chips.map((c) => c.label)).toEqual(['cat', 'cathode', 'cd']);
    expect(chips.map((c) => c.matchLen)).toEqual([1, 1, 1]);
    expect(more).toBe(5);
    expect(chips.every((c) => c.action.kind === 'apply')).toBe(true);
  });

  it('marks the typed part of a path by its last name, and carries swatches', () => {
    expect(chipsFor(input('cat documents/li')).chips.map((c) => [c.label, c.matchLen])).toEqual([['linux.txt', 2]]);
    const themes = chipsFor(input('theme set k')).chips;
    expect(themes.map((c) => [c.label, c.swatch])).toEqual([
      ['kangaroo', '#262626'],
      ['kookaburra', '#222222'],
    ]);
  });

  it("offers what comes next after a word typed in full: 'theme' gives ls and set", () => {
    const { chips } = chipsFor(input('theme'));
    expect(chips.map((c) => c.label)).toEqual(['ls', 'set']);
    expect(applyChip(chips[1] ?? chips[0]!)?.text).toBe('theme set ');
  });

  it('shows the whole list after Tab, and marks the menu choice', () => {
    const state = at('c');
    const listed = pressTab(TAB_IDLE, state, env);
    const all = chipsFor(input('c', { tab: listed.tab, max: 2 }));
    expect(all.chips).toHaveLength(8);
    expect(all.more).toBe(0);
    const menu = pressTab(listed.tab, state, env);
    const marked = chipsFor(input('cat', { tab: menu.tab }));
    expect(marked.chips.map((c) => c.selected === true)).toEqual([true, false, false, false, false, false, false, false]);
  });

  it('offers the starters, in the owner order, on an empty line on a touch screen only', () => {
    const starters = chipsFor(input('', { touch: true }));
    expect(starters.chips.map((c) => c.label)).toEqual(['help', 'cat README.md', 'fastfetch', 'ls', 'theme ls', 'cathode ls']);
    expect(starters.chips.every((c) => c.kind === 'starter' && c.action.kind === 'run')).toBe(true);
    expect(starters.chips[1]?.action).toEqual({ kind: 'run', line: 'cat README.md' });
    expect(chipsFor(input('', { touch: false })).chips).toEqual([]);
  });

  it('offers the command a line that was not found probably meant, as the shell does', () => {
    const after = chipsFor(input('', { lastStatus: 127, history: ['ls', 'pwdd -L'] }));
    expect(after.chips.map((c) => [c.label, c.kind, c.action])).toEqual([['pwd -L', 'didyoumean', { kind: 'run', line: 'pwd -L' }]]);
    // Only after a 127, and never for a guess that would open a page or end the session.
    expect(chipsFor(input('', { lastStatus: 1, history: ['pwdd'] })).chips).toEqual([]);
    expect(chipsFor(input('', { lastStatus: 127, history: ['rest'] })).chips.map((c) => c.label)).not.toContain('reset');
  });

  it('offers a near command for an unknown word while typing, which only edits the line', () => {
    const { chips } = chipsFor(input('fastfecth'));
    expect(chips.map((c) => [c.label, c.kind])).toEqual([['fastfetch', 'didyoumean']]);
    expect(applyChip(chips[0]!)).toEqual({ text: 'fastfetch ', cursor: 10 });
  });

  it('shows cancel ^C while a command runs, and Cancel at a secret prompt', () => {
    expect(chipsFor(input('', { mode: 'busy' })).chips.map((c) => [c.label, c.action.kind])).toEqual([['cancel ^C', 'interrupt']]);
    expect(chipsFor(input('ls', { mode: 'busy', touch: true, env })).chips).toHaveLength(1);
    expect(chipsFor(input('', { mode: 'secret' })).chips.map((c) => [c.label, c.action.kind])).toEqual([['Cancel', 'cancel']]);
    expect(chipsFor(input('', { mode: 'search' })).chips).toEqual([]);
  });

  it('offers nothing for a word typed in full with nothing after it', () => {
    expect(chipsFor(input('pwd')).chips).toEqual([]);
    expect(chipsFor(input('pw')).chips.map((c) => c.label)).toEqual(['pwd']);
  });

  it('has nothing to say before the engine has a result', () => {
    expect(chipsFor({ ...input('ca'), result: null }).chips).toEqual([]);
  });
});

describe('a chip and the Tab menu make the same line', () => {
  /** Menu-selects candidate i of `line` and presses Enter. */
  function menuSelect(state: EditState, index: number): EditState | undefined {
    let tab: TabState = TAB_IDLE;
    let current = state;
    // Into the list first (extending if it can), then into the menu, then along it.
    for (let guard = 0; guard < 10 && tab.phase !== 'listed'; guard += 1) {
      const step = pressTab(tab, current, env);
      tab = step.tab;
      if (step.effect.edit) current = step.effect.edit;
    }
    for (let i = 0; i <= index; i += 1) {
      const step = pressTab(tab, current, env);
      tab = step.tab;
      if (step.effect.edit) current = step.effect.edit;
    }
    return menuKey(tab, 'enter').effect.edit;
  }

  it.each(['c', 'theme ', 'theme set k', 'cd ', 'ls --al', 'cat "documents/', 'cat documents/m', 'echo $HO', 'cathode quality ', 'weather '])(
    'for %j',
    (line) => {
      // The line the list is shown for: after any extension Tab makes first.
      let state = at(line);
      let tab: TabState = TAB_IDLE;
      while (tab.phase !== 'listed') {
        const step = pressTab(tab, state, env);
        tab = step.tab;
        if (step.effect.edit) state = step.effect.edit;
        if (step.tab.phase === 'idle') return;
      }
      const { chips } = chipsFor(input('', { state, result: complete(state, env), tab, max: 200 }));
      expect(chips.length).toBeGreaterThan(1);
      chips.forEach((chip, i) => {
        expect(applyChip(chip), `${line} #${i}`).toEqual(menuSelect(state, i));
      });
    },
  );
});

/** The dock's chips: a thumb's, with the session's env, after `last` ran. */
function thumb(line: string, extra: Partial<ChipInput> = {}): ChipInput {
  return input(line, { touch: true, env, max: 24, ...extra });
}

const runs = (chips: readonly { line?: string }[]) => chips.map((chip) => chip.line);

describe('the dock: follow-ups after a run', () => {
  it('offers every theme after theme ls, each run in one tap, then the starters', () => {
    const { chips } = chipsFor(thumb('', { last: { line: 'theme ls', argv: ['theme', 'ls'], status: 0 } }));
    const followups = chips.filter((chip) => chip.kind === 'followup');
    const themes = env.appearance?.themes().map((theme) => `theme set ${theme.name.toLowerCase()}`) ?? [];
    expect(themes.length).toBeGreaterThan(5);
    expect(followups.map((chip) => chip.label)).toEqual(themes.slice(0, 12));
    expect(followups.every((chip) => chip.action.kind === 'run' && chip.line === chip.label)).toBe(true);
    // The starters follow, without a line already offered.
    expect(chips.slice(followups.length).map((chip) => chip.kind)).toContain('starter');
    expect(new Set(runs(chips)).size).toBe(chips.length);
  });

  it('offers the files to read and the folders to go into after ls', () => {
    const lines = runs(chipsFor(thumb('', { last: { line: 'ls', argv: ['ls'], status: 0 } })).chips.filter((chip) => chip.kind === 'followup'));
    expect(lines).toContain('cat README.md');
    expect(lines).toContain('cd documents');
    // Hidden names stay hidden, and a name with a space is never put in a tappable line.
    expect(lines.some((line) => line?.includes(' .') === true)).toBe(false);
    const inside = runs(chipsFor(thumb('', { last: { line: 'ls documents', argv: ['ls', 'documents'], status: 0 } })).chips);
    expect(inside).toContain('cat documents/linux.txt');
    expect(inside.some((line) => line?.includes('my notes') === true)).toBe(false);
  });

  it('offers a few commands after help, cd and ls after mkdir, and ls after cd', () => {
    const after = (line: string, status = 0) =>
      runs(chipsFor(thumb('', { last: { line, argv: line.split(' '), status } })).chips.filter((chip) => chip.kind === 'followup'));
    expect(after('help')).toEqual(['cat README.md', 'ls', 'fastfetch', 'theme ls', 'man ls']);
    expect(after('help ls')).toEqual(['man ls']);
    expect(after('mkdir x')).toEqual(['cd x', 'ls']);
    expect(after('cd documents')).toEqual(['ls']);
    // Nothing follows a failure.
    expect(after('mkdir x', 1)).toEqual([]);
    expect(after('theme ls', 130)).toEqual([]);
  });

  it('reads the words of a line run before the kernel could say them', () => {
    const { chips } = chipsFor(thumb('', { last: { line: 'mkdir notes', argv: null, status: 0 } }));
    expect(runs(chips.filter((chip) => chip.kind === 'followup'))).toEqual(['cd notes', 'ls']);
  });

  it('never offers a follow-up line that quotes, expands or chains, nor one from a next() that throws', () => {
    const lines = ['echo "hi"', 'echo $HOME', 'ls; rm -r ~', 'cat a|b', '  ', 'ls -l'];
    const sneaky: CommandSpec = defineCommand({ name: 'sneaky', category: 'fun', summary: 'offers odd lines', next: () => lines, run: () => 0 });
    const broken: CommandSpec = defineCommand({ name: 'broken', category: 'fun', summary: 'throws', next: () => { throw new Error('no'); }, run: () => 0 });
    const registry = {
      get: (name: string) => (name === 'sneaky' ? sneaky : name === 'broken' ? broken : env.registry.get(name)),
      list: () => env.registry.list(),
      suggest: (name: string) => env.registry.suggest(name),
    };
    const sneakyChips = chipsFor(thumb('', { registry, last: { line: 'sneaky', argv: ['sneaky'], status: 0 } })).chips;
    expect(runs(sneakyChips.filter((chip) => chip.kind === 'followup'))).toEqual(['ls -l']);
    const brokenChips = chipsFor(thumb('', { registry, last: { line: 'broken', argv: ['broken'], status: 0 } })).chips;
    expect(brokenChips.every((chip) => chip.kind === 'starter')).toBe(true);
  });

  it('keeps follow-ups and starters off a desktop, where Enter and Tab do the work', () => {
    expect(chipsFor(input('', { env, last: { line: 'theme ls', argv: ['theme', 'ls'], status: 0 } })).chips).toEqual([]);
  });

  it('puts the did-you-mean first after a command was not found', () => {
    const { chips } = chipsFor(thumb('', { lastStatus: 127, last: { line: 'hlep', argv: ['hlep'], status: 127 } }));
    expect(chips[0]).toMatchObject({ kind: 'didyoumean', label: 'help', line: 'help' });
    // The session's own record wins over the newest history line.
    expect(chipsFor(thumb('', { history: ['hlep'], lastStatus: 127, last: { line: 'ls', argv: ['ls'], status: 0 } })).chips[0]?.kind).not.toBe('didyoumean');
  });
});

describe('the dock: building a line by tapping', () => {
  it("runs a candidate that finishes the line in one tap, labelled with its word only: 'theme set w' and wombat", () => {
    const { chips } = chipsFor(thumb('theme set w'));
    const wombat = chips.find((chip) => chip.label === 'wombat');
    expect(wombat?.action).toMatchObject({ kind: 'apply', run: true });
    expect(wombat?.line).toBe('theme set wombat');
    // Exactly what Tab would put on the line.
    expect(wombat === undefined ? null : applyChip(wombat)).toEqual({ text: 'theme set wombat ', cursor: 17 });
  });

  it("offers ls to run and set to go on with after 'theme ', and the line itself first", () => {
    const { chips } = chipsFor(thumb('theme '));
    expect(chips.map((chip) => [chip.kind, chip.label, chip.line ?? null])).toEqual([
      ['current', 'theme', 'theme '.trimEnd()],
      ['subcommand', 'ls', 'theme ls'],
      ['subcommand', 'set', null],
    ]);
    expect(chipsFor(thumb('the')).chips.map((chip) => [chip.label, chip.line ?? null])).toEqual([['theme', null]]);
  });

  it('inserts a folder, and offers what is inside it next', () => {
    const [documents] = chipsFor(thumb('cd doc')).chips;
    expect(documents).toMatchObject({ label: 'documents/', kind: 'dir' });
    expect(documents?.line).toBeUndefined();
    const inside = chipsFor(thumb('cd documents/')).chips;
    expect(inside[0]?.kind).toBe('current');
    expect(inside.slice(1).every((chip) => chip.kind === 'dir' && chip.line === undefined)).toBe(true);
  });

  it('never runs a file, a flag or a command name in one tap', () => {
    for (const line of ['cat doc', 'cat documents/li', 'ls --al', 'fastf', 'he']) {
      const { chips } = chipsFor(thumb(line));
      expect(chips.filter((chip) => chip.kind !== 'current').every((chip) => chip.line === undefined), line).toBe(true);
    }
  });

  it('marks nothing to run on a desktop, where a click only completes', () => {
    expect(chipsFor(input('theme set w', { env })).chips.every((chip) => chip.line === undefined)).toBe(true);
  });
});

describe('the dock: the line ready to run', () => {
  it('comes first when the line is a whole, known command', () => {
    for (const line of ['pwd', 'theme', 'cd documents', 'ls -l', 'echo hi | cat -n', 'cat README.md', 'sleep 5 &', 'll']) {
      const [first] = chipsFor(thumb(line)).chips;
      expect(first, line).toMatchObject({ kind: 'current', label: line, line, action: { kind: 'run', line } });
    }
  });

  it('waits for the rest of a line: a missing operand, a word still being typed, an open quote, a dangling pipe', () => {
    for (const line of ['theme set ', 'theme set wom', 'cat READ', 'echo "hi', 'ls |', 'ls >', 'nosuchcommand', 'mkdir ', 'cathode quality x y |']) {
      expect(chipsFor(thumb(line)).chips.some((chip) => chip.kind === 'current'), line).toBe(false);
    }
  });

  it('is never offered on a desktop', () => {
    expect(chipsFor(input('pwd', { env })).chips).toEqual([]);
  });
});

describe('readyToRun', () => {
  it.each([
    ['ls', true],
    ['ls -la ~', true],
    ['X=1 ls', true],
    ['ls 2>&1 | cat', true],
    ['theme set wombat', true],
    ['', false],
    ['   ', false],
    ['theme set', false],
    ['ls &&', false],
    ['| ls', false],
    ['ls > ', false],
    ["echo 'open", false],
    ['$CMD', false],
    ['nosuch', false],
    ['mkdir', false],
    ['head -n', false],
  ])('%j is %s', (line, ready) => {
    expect(readyToRun(line, env)).toBe(ready);
  });
});
