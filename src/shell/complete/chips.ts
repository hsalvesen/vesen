// The chips under the prompt, and in the phone dock (docs/plan/designs/terminal-input.md,
// chips.ts; designs/phone-and-instagram.md, "B. Exploring by tapping"; 02, sections 5 and 6).
//
// - While typing: the completions, or what comes next after an exact word ('theme' offers ls
//   and set). On a touch screen a candidate that finishes the line runs it in one tap (wombat
//   after `theme set `), and a line ready to run gets a first [⏎ line] chip.
// - After Tab: the whole list, with the menu's choice marked.
// - On an empty line: after a command was not found, what it probably meant; on a touch screen,
//   then the follow-ups the last command's spec offers (every theme after `theme ls`), then the
//   starter commands, which run in one tap.
// - While a command runs: cancel; at a secret prompt: Cancel.
//
// Every action is made here from specs, files and history, never from text a command printed,
// and a line a tap runs is made only of plain words.

import { resolve } from '../../vfs/path';
import { lex } from '../lexer';
import type { RedirOp } from '../lexer-types';
import type { Candidate, NextContext } from '../types';
import { cursorContext } from './context';
import { accept } from './engine';
import type { Chip, ChipInput, ChipKind, ChipList, CompletionEnv, CompletionResult } from './types';

const NONE: ChipList = { chips: [], more: 0 };

/** Words safe to carry into a tappable did-you-mean, as the shell's own suggestion does. */
const PLAIN_WORD = /^[\w.,:@%+=/~-]+$/;

/** Redirections that need no target word: `2>&1`. */
const NO_TARGET: ReadonlySet<RedirOp> = new Set(['2>&1', '>&2', '>&1']);

/** Candidates whose choice can finish a line: a subcommand, or a value such as a theme name. */
const FINISHING: ReadonlySet<ChipKind> = new Set(['subcommand', 'value']);

/** How many follow-up lines one command may offer. */
export const MAX_FOLLOWUPS = 12;

/** How many letters of a candidate's label the typed text covers, shown bold. */
function matchLength(result: CompletionResult, candidate: Candidate): number {
  // A path's label is its last name: only the part typed after the last '/' counts.
  const folder = candidate.value.length - candidate.label.length;
  const typed = candidate.value.endsWith(candidate.label) && folder > 0 ? result.prefix.length - folder : result.prefix.length;
  return Math.max(0, Math.min(typed, candidate.label.length));
}

/** The words of a line made only of plain, unquoted words, or null. */
function plainWords(line: string): string[] | null {
  const lexed = lex(line);
  if (!lexed.complete || lexed.commentAt !== null) return null;
  const words: string[] = [];
  for (const token of lexed.tokens) {
    if (token.kind !== 'word' || token.quoted) return null;
    // A plain `~` (home, never another user's) is the only expansion allowed: `cat ~/README.md`.
    if (!token.parts.every((part) => part.kind === 'lit' || (part.kind === 'tilde' && part.user === undefined))) return null;
    words.push(token.value);
  }
  return words;
}

/** A name the shell would run: a command, or an alias. */
function knownCommand(name: string, env: CompletionEnv): boolean {
  return env.registry.get(name) !== undefined || env.aliases().has(name);
}

/**
 * True when `text` is a whole command line that would run: complete quotes, a known command in
 * every place a command goes, nothing dangling after a `|` or a `>`, and no required operand
 * missing from the last command. It need not succeed: `cat nothing` is ready.
 */
export function readyToRun(text: string, env: CompletionEnv): boolean {
  if (text.trim() === '') return false;
  const lexed = lex(text);
  if (!lexed.complete) return false;
  let wantCommand = true;
  let wantTarget = false;
  let commands = 0;
  let lastOp: string | null = null;
  for (const token of lexed.tokens) {
    if (token.kind === 'op') {
      if (wantCommand || wantTarget) return false;
      wantCommand = true;
      lastOp = token.value;
      continue;
    }
    lastOp = null;
    if (token.kind === 'redir') {
      if (wantTarget) return false;
      wantTarget = !NO_TARGET.has(token.value);
      continue;
    }
    if (wantTarget) {
      wantTarget = false;
      continue;
    }
    if (!wantCommand) continue;
    // NAME=value before the command assigns.
    if (token.assign !== undefined) continue;
    if (token.quoted || token.parts.some((part) => part.kind !== 'lit') || !knownCommand(token.value, env)) return false;
    wantCommand = false;
    commands += 1;
  }
  if (wantTarget || commands === 0) return false;
  // `ls |` waits for more; `ls;` and `sleep 5 &` are whole.
  if (lastOp !== null && lastOp !== ';' && lastOp !== '&') return false;
  if (wantCommand && lastOp === null) return false;

  // The last command's next operand: a required one missing, or a flag waiting for its value.
  const end = /\s$/.test(text) ? text : `${text} `;
  const at = cursorContext({ text: end, cursor: end.length }, env);
  if (at.slot === 'flag-value' || at.slot === 'redirect') return false;
  if (at.slot === 'arg' && at.spec !== undefined) {
    const sub = at.sub === undefined ? undefined : at.spec.subcommands?.[at.sub];
    const operands = at.sub === undefined ? (at.spec.args ?? []) : (sub?.args ?? []);
    const next = operands[at.argIndex];
    if (next !== undefined && next.optional !== true) return false;
  }
  return true;
}

/**
 * The line a candidate finishes, when choosing it leaves nothing more to give: `theme set w` and
 * wombat make `theme set wombat`. Null when the line goes on (a folder, a flag, a command that
 * takes more) or the candidate lands before other text.
 */
function finishedLine(result: CompletionResult, candidate: Candidate, env: CompletionEnv): string | null {
  if (!candidate.terminal || !FINISHING.has(candidate.kind)) return null;
  const after = accept(result, candidate, 'final');
  if (after.text.slice(after.cursor).trim() !== '') return null;
  if (!readyToRun(after.text, env)) return null;
  const at = cursorContext({ text: after.text, cursor: after.text.length }, env);
  return at.slot === 'none' ? after.text.trimEnd() : null;
}

function completionChips(result: CompletionResult, max: number, highlight: number | null, input: ChipInput): ChipList {
  const shown = result.candidates.slice(0, Math.max(0, max));
  const env = input.touch ? input.env : undefined;
  const chips = shown.map((candidate, i): Chip => {
    const runs = env === undefined ? null : finishedLine(result, candidate, env);
    return {
      id: `${candidate.kind}:${candidate.value}`,
      label: candidate.label,
      matchLen: matchLength(result, candidate),
      kind: candidate.kind,
      action: { kind: 'apply', result, candidate, ...(runs === null ? {} : { run: true }) },
      ...(runs === null ? {} : { line: runs }),
      ...(candidate.summary === undefined ? {} : { summary: candidate.summary }),
      ...(candidate.swatch === undefined ? {} : { swatch: candidate.swatch }),
      ...(highlight === i ? { selected: true } : {}),
    };
  });
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

/** The line that ran last: the session's own record, or the newest history line. */
function lastLine(input: ChipInput): { line: string; status: number | undefined } | null {
  if (input.last != null) return { line: input.last.line, status: input.last.status };
  const line = input.history[input.history.length - 1];
  return line === undefined ? null : { line, status: input.lastStatus };
}

/** The commands a line that was not found probably meant, run as the shell's own suggestion runs them. */
function afterNotFound(input: ChipInput): Chip[] {
  const last = lastLine(input);
  if (last === null || last.status !== 127) return [];
  const words: string[] = [];
  for (const token of lex(last.line).tokens) {
    if (token.kind !== 'word') return [];
    words.push(token.value);
  }
  const [name, ...rest] = words;
  if (name === undefined || input.registry.get(name) !== undefined) return [];
  return input.registry.suggest(name).near.map((near) => {
    const run = rest.length > 0 && rest.every((word) => PLAIN_WORD.test(word)) ? [near, ...rest].join(' ') : near;
    return { id: `didyoumean:${near}`, label: run, matchLen: 0, kind: 'didyoumean' as ChipKind, action: { kind: 'run', line: run }, line: run, summary: `did you mean ${near}?` };
  });
}

/** What a spec's next() may read: the theme list, and the folders. */
function nextContext(env: CompletionEnv | undefined): NextContext {
  if (env === undefined) return {};
  return {
    ...(env.appearance === undefined ? {} : { appearance: env.appearance }),
    list: (path) => {
      try {
        const entries = env.fs.list(resolve(path, env.cwd(), env.home()));
        return entries === null ? null : entries.map(({ name, type }) => ({ name, type }));
      } catch {
        return null;
      }
    },
  };
}

/** True when every word of `line` is plain: nothing a tap runs can quote, expand, glob or chain. */
function plainLine(line: string): boolean {
  const words = plainWords(line);
  return words !== null && words.length > 0 && words.every((word) => PLAIN_WORD.test(word));
}

/** The lines the last command's spec offers next: every theme after `theme ls`. */
function followUps(input: ChipInput): Chip[] {
  const last = input.last;
  if (last == null) return [];
  const argv = last.argv ?? plainWords(last.line);
  const name = argv?.[0];
  if (argv === null || name === undefined) return [];
  const spec = input.registry.get(name);
  if (spec?.next === undefined) return [];
  let lines: readonly string[];
  try {
    lines = spec.next({ status: last.status, argv }, nextContext(input.env));
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    if (typeof raw !== 'string') continue;
    const line = raw.trim();
    if (seen.has(line) || !plainLine(line)) continue;
    seen.add(line);
    chips.push({ id: `followup:${line}`, label: line, matchLen: 0, kind: 'followup', action: { kind: 'run', line }, line });
    if (chips.length >= MAX_FOLLOWUPS) break;
  }
  return chips;
}

/** The starter commands, by their rank in the specs' examples, labelled as the example says. */
function starters(input: ChipInput): Chip[] {
  const ranked: { line: string; label: string; rank: number; summary: string }[] = [];
  for (const spec of input.registry.list()) {
    for (const example of spec.examples ?? []) {
      if (example.starter !== undefined) {
        ranked.push({ line: example.line, label: example.label ?? example.line, rank: example.starter, summary: example.note ?? spec.summary });
      }
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .map(({ line, label, summary }) => ({ id: `starter:${line}`, label, matchLen: 0, kind: 'starter' as ChipKind, action: { kind: 'run', line }, line, summary }));
}

/** A follow-up that runs a starter's line wears the starter's label: help's `cat README.md`. */
function labelledLike(chips: readonly Chip[], starting: readonly Chip[]): Chip[] {
  const labels = new Map(starting.map((chip) => [chip.line, chip.label]));
  return chips.map((chip) => {
    const label = chip.line === undefined ? undefined : labels.get(chip.line);
    return label === undefined || label === chip.label ? chip : { ...chip, label };
  });
}

/** The line itself, first, when it is ready to run and the word at the cursor is whole. */
function currentChip(input: ChipInput, env: CompletionEnv): Chip | null {
  const text = input.state.text;
  if (!readyToRun(text, env)) return null;
  const result = input.result;
  const atEnd = input.state.cursor >= text.trimEnd().length;
  if (result !== null && atEnd && result.prefix !== '' && result.total > 0) {
    // `theme set wom` and `cat READ` are still being typed; `cd documents` is whole.
    const typed = result.prefix.toLowerCase();
    if (!result.candidates.some((c) => c.value.toLowerCase() === typed || c.value.toLowerCase() === `${typed}/`)) return null;
  }
  // As typed, so a leading space still keeps the line out of history.
  const line = text.trimEnd();
  return { id: 'current', label: line.trim(), matchLen: 0, kind: 'current', action: { kind: 'run', line }, line, summary: 'run this line' };
}

function capped(chips: readonly Chip[], max: number): ChipList {
  const shown = chips.slice(0, Math.max(0, max));
  return { chips: shown, more: chips.length - shown.length };
}

/** Drops chips that run a line an earlier chip already runs. */
function distinct(chips: readonly Chip[]): Chip[] {
  const seen = new Set<string>();
  return chips.filter((chip) => {
    const key = chip.action.kind === 'run' ? `run:${chip.action.line}` : chip.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The chips for the prompt as it is now. */
export function chipsFor(input: ChipInput): ChipList {
  switch (input.mode) {
    case 'busy':
      return {
        chips: [{ id: 'control:stop', label: 'cancel ^C', matchLen: 0, kind: 'control', action: { kind: 'interrupt' }, summary: 'stop the running command' }],
        more: 0,
      };
    case 'secret':
      return { chips: [{ id: 'control:cancel', label: 'Cancel', matchLen: 0, kind: 'control', action: { kind: 'cancel' }, summary: 'leave the password prompt' }], more: 0 };
    case 'search':
      return NONE;
    case 'edit':
      break;
  }
  const { tab, result } = input;
  if (tab.phase === 'listed') return completionChips(tab.result, tab.result.candidates.length, null, input);
  if (tab.phase === 'menu') return completionChips(tab.result, tab.result.candidates.length, tab.index, input);
  if (tab.phase === 'asking') return NONE;

  if (input.state.text.trim() === '') {
    const starting = input.touch ? starters(input) : [];
    const chips = [...afterNotFound(input), ...(input.touch ? [...labelledLike(followUps(input), starting), ...starting] : [])];
    return capped(distinct(chips), input.max);
  }

  const current = input.touch && input.env !== undefined ? currentChip(input, input.env) : null;
  const room = current === null ? input.max : input.max - 1;
  let list: ChipList = NONE;
  if (result === null) list = NONE;
  else if (result.total === 0) list = nearChips(result, room);
  else if (result.next !== undefined) list = completionChips(result.next, room, null, input);
  // A word already typed in full has nothing to offer: `pwd` is not followed by [pwd].
  else if (result.total === 1 && result.candidates[0]?.value === result.prefix) list = NONE;
  else list = completionChips(result, room, null, input);
  return current === null ? list : { chips: [current, ...list.chips], more: list.more };
}

/** The line a chip that edits makes, the same as Tab or the menu would; null for the others. */
export function applyChip(chip: Chip): ReturnType<typeof accept> | null {
  return chip.action.kind === 'apply' ? accept(chip.action.result, chip.action.candidate, 'final') : null;
}
