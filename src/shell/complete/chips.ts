// The chips under the prompt, and in the phone dock (docs/plan/designs/terminal-input.md,
// chips.ts; 02, sections 5 and 6). While typing: the completions, or what comes next after an
// exact word ('theme' offers ls and set). After Tab: the whole list, with the menu's choice
// marked. On an empty line on a touch screen: the starter commands, which run in one tap. After
// a command was not found: the commands it was probably meant to be. While a command runs: Stop;
// at a secret prompt: Cancel. Every action is made here from specs, files and history, never
// from text a command printed.

import { lex } from '../lexer';
import type { Candidate } from '../types';
import { accept } from './engine';
import type { Chip, ChipInput, ChipKind, ChipList, CompletionResult } from './types';

const NONE: ChipList = { chips: [], more: 0 };

/** Words safe to carry into a tappable did-you-mean, as the shell's own suggestion does. */
const PLAIN_WORD = /^[\w.,:@%+=/~-]+$/;

/** How many letters of a candidate's label the typed text covers, shown bold. */
function matchLength(result: CompletionResult, candidate: Candidate): number {
  // A path's label is its last name: only the part typed after the last '/' counts.
  const folder = candidate.value.length - candidate.label.length;
  const typed = candidate.value.endsWith(candidate.label) && folder > 0 ? result.prefix.length - folder : result.prefix.length;
  return Math.max(0, Math.min(typed, candidate.label.length));
}

function completionChips(result: CompletionResult, max: number, highlight: number | null): ChipList {
  const shown = result.candidates.slice(0, Math.max(0, max));
  const chips = shown.map(
    (candidate, i): Chip => ({
      id: `${candidate.kind}:${candidate.value}`,
      label: candidate.label,
      matchLen: matchLength(result, candidate),
      kind: candidate.kind,
      action: { kind: 'apply', result, candidate },
      ...(candidate.summary === undefined ? {} : { summary: candidate.summary }),
      ...(candidate.swatch === undefined ? {} : { swatch: candidate.swatch }),
      ...(highlight === i ? { selected: true } : {}),
    }),
  );
  return { chips, more: Math.max(0, result.total - chips.length) };
}

/** `fastfecth` -> fastfetch: a word swapped for a command name, through accept like any chip. */
function nearChips(result: CompletionResult, max: number): ChipList {
  const chips = (result.near ?? []).slice(0, max).map(
    (name): Chip => ({
      id: `didyoumean:${name}`,
      label: name,
      matchLen: 0,
      kind: 'didyoumean',
      action: { kind: 'apply', result, candidate: { value: name, label: name, kind: 'command', terminal: true } },
      summary: `did you mean ${name}?`,
    }),
  );
  return { chips, more: 0 };
}

/** The commands a line that was not found probably meant, run as the shell's own suggestion runs them. */
function afterNotFound(input: ChipInput): Chip[] {
  const line = input.history[input.history.length - 1];
  if (line === undefined) return [];
  const words: string[] = [];
  for (const token of lex(line).tokens) {
    if (token.kind !== 'word') return [];
    words.push(token.value);
  }
  const [name, ...rest] = words;
  if (name === undefined || input.registry.get(name) !== undefined) return [];
  return input.registry.suggest(name).near.map((near) => {
    const run = rest.length > 0 && rest.every((word) => PLAIN_WORD.test(word)) ? [near, ...rest].join(' ') : near;
    return { id: `didyoumean:${near}`, label: run, matchLen: 0, kind: 'didyoumean' as ChipKind, action: { kind: 'run', line: run }, summary: `did you mean ${near}?` };
  });
}

/** The starter commands, by their rank in the specs' examples. */
function starters(input: ChipInput): Chip[] {
  const ranked: { line: string; rank: number; summary: string }[] = [];
  for (const spec of input.registry.list()) {
    for (const example of spec.examples ?? []) {
      if (example.starter !== undefined) ranked.push({ line: example.line, rank: example.starter, summary: example.note ?? spec.summary });
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .map(({ line, summary }) => ({ id: `starter:${line}`, label: line, matchLen: 0, kind: 'starter' as ChipKind, action: { kind: 'run', line }, summary }));
}

function capped(chips: readonly Chip[], max: number): ChipList {
  const shown = chips.slice(0, Math.max(0, max));
  return { chips: shown, more: chips.length - shown.length };
}

/** The chips for the prompt as it is now. */
export function chipsFor(input: ChipInput): ChipList {
  switch (input.mode) {
    case 'busy':
      return { chips: [{ id: 'control:stop', label: 'Stop', matchLen: 0, kind: 'control', action: { kind: 'interrupt' }, summary: 'stop the running command' }], more: 0 };
    case 'secret':
      return { chips: [{ id: 'control:cancel', label: 'Cancel', matchLen: 0, kind: 'control', action: { kind: 'cancel' }, summary: 'leave the password prompt' }], more: 0 };
    case 'search':
      return NONE;
    case 'edit':
      break;
  }
  const { tab, result } = input;
  if (tab.phase === 'listed') return completionChips(tab.result, tab.result.candidates.length, null);
  if (tab.phase === 'menu') return completionChips(tab.result, tab.result.candidates.length, tab.index);
  if (tab.phase === 'asking') return NONE;

  if (input.state.text.trim() === '') {
    const chips = [...(input.lastStatus === 127 ? afterNotFound(input) : []), ...(input.touch ? starters(input) : [])];
    return capped(chips, input.max);
  }
  if (result === null) return NONE;
  if (result.total === 0) return nearChips(result, input.max);
  if (result.next !== undefined) return completionChips(result.next, input.max, null);
  // A word already typed in full has nothing to offer: `pwd` is not followed by [pwd].
  if (result.total === 1 && result.candidates[0]?.value === result.prefix) return NONE;
  return completionChips(result, input.max, null);
}

/** The line a chip that edits makes, the same as Tab or the menu would; null for the others. */
export function applyChip(chip: Chip): ReturnType<typeof accept> | null {
  return chip.action.kind === 'apply' ? accept(chip.action.result, chip.action.candidate, 'final') : null;
}
