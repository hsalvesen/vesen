// The completion engine (docs/plan/designs/terminal-input.md, "COMPLETION ENGINE"; 02, section
// 5): complete() finds what the word under the cursor could become, and accept() puts one of
// those on the line, the one way Tab, the menu, a chip and the ghost all edit it. complete()
// never throws: whatever goes wrong inside a source, the answer is "no completions".

import type { Candidate } from '../types';
import { cursorContext, type CursorContext } from './context';
import { MAX_CANDIDATES, dedupe, didYouMean, longestCommonPrefix, matchPrefix, sortCandidates } from './match';
import { cutAt, escapeTail, scanRaw } from './quote';
import { commandCandidates, gather, valuePool, type Pool } from './sources';
import type { AcceptMode, CompletionEnv, CompletionResult, EditState } from './types';

function clampState(state: EditState): EditState {
  const text = typeof state.text === 'string' ? state.text : '';
  const cursor = Number.isFinite(state.cursor) ? Math.max(0, Math.min(Math.floor(state.cursor), text.length)) : text.length;
  return { text, cursor };
}

function emptyResult(state: EditState): CompletionResult {
  return {
    state,
    replaceFrom: state.cursor,
    replaceTo: state.cursor,
    atWordStart: true,
    quoteAtFrom: null,
    prefix: '',
    quote: null,
    slot: 'none',
    candidates: [],
    total: 0,
    common: '',
    caseFolded: false,
  };
}

/** The dim hint for an empty word: a free argument's placeholder, or the argument's name. */
function placeholderFor(context: CursorContext): string | undefined {
  if (context.slot !== 'arg' && context.slot !== 'flag-value') return undefined;
  if (context.source?.kind === 'free') return context.source.placeholder;
  return context.valueName;
}

/** True when what follows is a short list worth showing before anything is typed: subcommands, enums, examples. */
function enumerable(resolved: Resolved): boolean {
  if (resolved.result.slot === 'subcommand') return true;
  return resolved.kind === 'enum' || resolved.kind === 'examples';
}

interface Resolved {
  readonly result: CompletionResult;
  /** The kind of source the candidates came from. */
  readonly kind: string | undefined;
}

function matchPool(pool: Pool, prefix: string): { matched: Candidate[]; caseFolded: boolean } {
  if (pool.matched === true) return { matched: [...pool.items], caseFolded: pool.caseFolded === true };
  return matchPrefix(pool.items, prefix, pool.caseInsensitive === true);
}

function resolve(state: EditState, env: CompletionEnv): Resolved {
  const context = cursorContext(state, env);
  let pool = gather(context, env);
  let kind: string | undefined = context.source?.kind;
  let { matched, caseFolded } = matchPool(pool, context.prefix);

  // `theme sw`: no subcommand starts so, but the command's own first argument may.
  const first = context.spec?.args?.[0];
  if (context.slot === 'subcommand' && matched.length === 0 && context.prefix !== '' && first !== undefined) {
    pool = valuePool({ ...context, slot: 'arg', source: first.source, valueName: first.name }, env);
    kind = first.source.kind;
    ({ matched, caseFolded } = matchPool(pool, context.prefix));
  }

  const unique = dedupe(matched, pool.caseInsensitive === true);
  const ordered = pool.ordered === true ? unique : sortCandidates(unique);
  const placeholder = placeholderFor(context);
  const near =
    context.slot === 'command' && ordered.length === 0 && context.prefix !== ''
      ? didYouMean(context.prefix, commandCandidates(env, false).map((c) => c.value))
      : [];
  const result: CompletionResult = {
    state,
    replaceFrom: context.from,
    replaceTo: state.cursor,
    atWordStart: context.atWordStart,
    quoteAtFrom: context.quoteAtFrom,
    prefix: context.prefix,
    quote: context.quote,
    slot: context.slot,
    ...(context.spec === undefined ? {} : { spec: context.spec }),
    ...(context.sub === undefined ? {} : { sub: context.sub }),
    ...(placeholder === undefined ? {} : { placeholder }),
    candidates: ordered.slice(0, MAX_CANDIDATES),
    total: ordered.length,
    common: longestCommonPrefix(ordered.map((c) => c.value)),
    caseFolded,
    ...(near.length > 0 ? { near } : {}),
  };
  return { result, kind };
}

/**
 * What the word under the cursor could become. Text after the cursor is kept. When the typed
 * word is exactly the one candidate and something enumerable follows it (subcommands, a theme
 * name), `next` is the completion of the line with that word accepted.
 */
export function complete(state: EditState, env: CompletionEnv): CompletionResult {
  const st = clampState(state);
  try {
    const { result } = resolve(st, env);
    const only = result.candidates[0];
    if (result.total !== 1 || only === undefined || only.value !== result.prefix || !only.terminal) return result;
    const after = resolve(accept(result, only, 'final'), env);
    return after.result.total > 0 && enumerable(after) ? { ...result, next: after.result } : result;
  } catch {
    // A source that failed offers nothing, rather than breaking the prompt.
    return emptyResult(st);
  }
}

/**
 * Puts a candidate on the line. What was typed stays as typed when the candidate starts with it;
 * only the rest is added, escaped for the quote it lands in. A candidate matched by ignoring case
 * rewrites what differs. 'final' finishes a whole word: it closes an open quote and adds a space
 * (or steps over one already there); a folder ('/') or `--opt=` gets nothing, so completion goes
 * on. 'cycle', for the Tab menu, adds nothing.
 */
export function accept(result: CompletionResult, candidate: Candidate, mode: AcceptMode = 'final'): EditState {
  const { text, cursor } = result.state;
  const from = result.replaceFrom;
  const raw = text.slice(from, cursor);
  const scan = scanRaw(raw, result.quoteAtFrom);
  const typed = scan.value;
  const value = candidate.value;
  let k = 0;
  while (k < typed.length && k < value.length && typed.charCodeAt(k) === value.charCodeAt(k)) k += 1;
  const cut = cutAt(scan, raw, k, result.quoteAtFrom);
  const tail = value.slice(k);
  // $NAME and ${NAME} go in as they are.
  const added = result.slot === 'var' ? tail : escapeTail(tail, cut.quote, result.atWordStart && cut.index === 0 && k === 0);
  const body = raw.slice(0, cut.index) + added;

  // A quote already closed after the cursor, or a space already there, is stepped over.
  let rest = text.slice(cursor);
  let inserted = body;
  if (mode === 'final' && candidate.terminal) {
    if (cut.quote !== null) {
      inserted += cut.quote;
      if (rest.startsWith(cut.quote)) rest = rest.slice(1);
    }
    inserted += ' ';
    if (rest.startsWith(' ')) rest = rest.slice(1);
  }
  const head = text.slice(0, from) + inserted;
  return { text: head + rest, cursor: head.length };
}

/** The line with the word extended to the prefix every candidate shares, or null when that adds nothing. */
export function extendToCommon(result: CompletionResult): EditState | null {
  if (result.total < 2 || result.common.length <= result.prefix.length) return null;
  return accept(result, { value: result.common, label: result.common, kind: 'value', terminal: false }, 'cycle');
}
