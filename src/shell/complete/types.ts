// The completion engine's contracts (docs/plan/02-architecture-and-contracts.md, section 5;
// docs/plan/designs/terminal-input.md, "Key interfaces"). One CompletionResult drives Tab, the
// grey ghost and the chips, all through one accept(). The engine (./index.ts) loads in its own
// chunk; the UI imports these types only, and reaches the engine through ShellPort.completion.

import type { Appearance } from '../../services/types';
import type { Quote } from '../lexer-types';
import type { Candidate, CandidateKind, CommandSpec, ExitCode, Registry } from '../types';

/** The line being edited and where the cursor is in it (a UTF-16 offset). */
export interface EditState {
  readonly text: string;
  readonly cursor: number;
}

/** One entry of a folder, as completion sees it. */
export interface FsEntry {
  readonly name: string;
  /** With symbolic links followed: a link to a folder is a 'dir'. */
  readonly type: 'file' | 'dir';
  /** A file the visitor may run. */
  readonly exec?: boolean;
}

export interface CompletionFs {
  /** The entries of the folder at an absolute path, dotfiles included; null when it cannot be listed. Never throws. */
  list(dir: string): readonly FsEntry[] | null;
}

/**
 * The commands, as completion reads them. `complete` and `whenComplete` are the catalogue's: a
 * first Tab on a command name waits a moment for it (PromptController), and the session's
 * completion store gives a new value when it arrives, so the list fills in.
 */
export type CompletionRegistry = Pick<Registry, 'get' | 'list' | 'suggest'> & Partial<Pick<Registry, 'complete' | 'whenComplete'>>;

/** What completion reads: the commands, the files, the variables, the aliases and history. */
export interface CompletionEnv {
  readonly registry: CompletionRegistry;
  readonly fs: CompletionFs;
  /** The working folder, absolute. */
  cwd(): string;
  /** $HOME. */
  home(): string;
  /** The shell's variables, by name, for $NAME. */
  vars(): readonly (readonly [string, string])[];
  /** The shell's aliases, name to value. */
  aliases(): ReadonlyMap<string, string>;
  /** Command history, oldest first. */
  history(): readonly string[];
  /** Where enum values such as the theme names come from. */
  readonly appearance?: Appearance;
}

/** What the word under the cursor is. */
export type Slot = 'command' | 'subcommand' | 'flag' | 'flag-value' | 'arg' | 'redirect' | 'var' | 'none';

export interface CompletionResult {
  /** The line this result is for. */
  readonly state: EditState;
  /** The text a candidate replaces is [replaceFrom, replaceTo); replaceTo is the cursor. */
  readonly replaceFrom: number;
  readonly replaceTo: number;
  /** True when replaceFrom is where the word starts, rather than inside it ($HO, --color=al). */
  readonly atWordStart: boolean;
  /** The quote open at replaceFrom: `"` for `echo "$HO`. */
  readonly quoteAtFrom: Quote | null;
  /** What was typed in that range, quotes removed and escapes applied. */
  readonly prefix: string;
  /** The quote still open at the cursor. */
  readonly quote: Quote | null;
  readonly slot: Slot;
  readonly spec?: CommandSpec;
  readonly sub?: string;
  /** A dim hint for an empty word: the argument's name or a free placeholder. Never accepted. */
  readonly placeholder?: string;
  /** Matching candidates, at most MAX_CANDIDATES of them. */
  readonly candidates: readonly Candidate[];
  /** How many matched before the cap. */
  readonly total: number;
  /** The longest prefix every match shares. */
  readonly common: string;
  /** True when the matches were found only by ignoring case. */
  readonly caseFolded: boolean;
  /** Commands close to an unknown command name, when nothing matched. */
  readonly near?: readonly string[];
  /**
   * The word names a command: the line's first word, or an operand such as help's. Its
   * candidates grow when the catalogue arrives.
   */
  readonly namesCommand?: boolean;
  /**
   * Lookahead: the typed word is exactly the only candidate, so this is what comes next, as the
   * completion of the line with that word accepted. 'theme' still offers ls and set.
   */
  readonly next?: CompletionResult;
}

/** 'final' closes an open quote and adds a space after a whole word; 'cycle' adds nothing. */
export type AcceptMode = 'final' | 'cycle';

// ── Tab ────────────────────────────────────────────────────────────────────────────────────

/**
 * The Tab state machine (02, section 5). A unique match is accepted; otherwise the common prefix
 * is extended; when nothing can extend, the list shows; the next Tab opens a menu that cycles.
 * Over ASK_ABOVE candidates, the list first asks. `key` is the line the phase belongs to: any
 * other line is a fresh start.
 */
export type TabState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'extended'; readonly key: string }
  | { readonly phase: 'asking'; readonly key: string; readonly result: CompletionResult }
  | { readonly phase: 'listed'; readonly key: string; readonly result: CompletionResult }
  | {
      readonly phase: 'menu';
      readonly key: string;
      readonly result: CompletionResult;
      readonly index: number;
      /** The line before the menu opened, which Escape puts back. */
      readonly anchor: EditState;
    };

/** What a Tab press asks the editor to do. */
export interface TabEffect {
  /** The new line and cursor. */
  readonly edit?: EditState;
  readonly list?: 'show' | 'hide';
  /** The menu's selected candidate. */
  readonly highlight?: number | null;
  /** Nothing to complete: flash, never beep. */
  readonly bell?: boolean;
  /** For the polite live region: 'No completions'. */
  readonly announce?: string;
  /** `Display all 150 possibilities? (y or n)` while asking; null clears it. */
  readonly question?: string | null;
}

export interface TabStep {
  readonly tab: TabState;
  readonly effect: TabEffect;
}

export type MenuKey = 'enter' | 'escape' | 'commit';

// ── Ghost ──────────────────────────────────────────────────────────────────────────────────

/** The grey text after the cursor. */
export interface Ghost {
  readonly text: string;
  readonly source: 'history' | 'completion' | 'placeholder';
  /** False for a placeholder: it is a hint, and Right never inserts it. */
  readonly acceptable: boolean;
}

// ── Chips ──────────────────────────────────────────────────────────────────────────────────

export type PromptMode = 'edit' | 'busy' | 'secret' | 'search';

/**
 * A completion's kind, or: a starter command on an empty line, a follow-up after a run, a
 * did-you-mean, the line itself when it is ready to run, or cancel (a running command) and Cancel (a password).
 */
export type ChipKind = CandidateKind | 'starter' | 'followup' | 'didyoumean' | 'current' | 'control';

/**
 * What a chip does. Only trusted code makes these (02, section 6): candidates from the specs,
 * the files and history, never text parsed from output.
 */
export type ChipAction =
  /**
   * Puts the candidate on the line exactly as Tab would. With `run`, a thumb's tap then runs the
   * line, because the candidate finishes it: `theme w` and wombat. A long press only edits.
   */
  | { readonly kind: 'apply'; readonly result: CompletionResult; readonly candidate: Candidate; readonly run?: boolean }
  /** Runs a line in one tap. */
  | { readonly kind: 'run'; readonly line: string }
  /** Stops the running command. */
  | { readonly kind: 'interrupt' }
  /** Leaves a secret prompt. */
  | { readonly kind: 'cancel' };

export interface Chip {
  /** Unique within one list. */
  readonly id: string;
  readonly label: string;
  /** How much of the label the typed text matched, shown bold. */
  readonly matchLen: number;
  readonly kind: ChipKind;
  readonly action: ChipAction;
  readonly summary?: string;
  /** A colour shown beside the label: a theme's background. */
  readonly swatch?: string;
  /** The candidate the Tab menu has on the line. */
  readonly selected?: boolean;
  /** The whole line a tap runs, for a chip that runs one: its name for screen readers says it. */
  readonly line?: string;
}

export interface ChipList {
  readonly chips: readonly Chip[];
  /** Matches not shown, for '+N more'. */
  readonly more: number;
}

export interface ChipInput {
  readonly mode: PromptMode;
  readonly state: EditState;
  /** The completion of `state`; null before the engine has loaded. */
  readonly result: CompletionResult | null;
  readonly tab: TabState;
  /**
   * Chips for a thumb, in the phone dock: the starters and follow-ups on an empty line, a
   * candidate that finishes the line runs it, and the line ready to run comes first.
   */
  readonly touch: boolean;
  readonly registry: Pick<Registry, 'get' | 'list' | 'suggest'>;
  /** Command history, oldest first. */
  readonly history: readonly string[];
  /**
   * The most chips to show while typing from an open-ended list (files, command names); a
   * closed list in the dock (subcommands, the theme names), the follow-ups and the starters on
   * an empty line, and a Tab list are shown whole.
   */
  readonly max: number;
  /** The status of the last line, for a did-you-mean after 127. */
  readonly lastStatus?: ExitCode;
  /** The line run last in this session, for its follow-ups and did-you-mean. */
  readonly last?: LastRun | null;
  /**
   * What completion reads, for the chips that look further than the word under the cursor: a
   * follow-up listing a folder, whether a line is ready to run, and which candidates finish it.
   */
  readonly env?: CompletionEnv;
}

/** A line that ran, as the chips after it see it. */
export interface LastRun {
  readonly line: string;
  /** Its words, when it was one simple command made of plain words; null otherwise. */
  readonly argv: readonly string[] | null;
  readonly status: ExitCode;
}

// ── The engine, as the UI reaches it ────────────────────────────────────────────────────────

export interface CompletionEngine {
  /** Never throws. */
  complete(state: EditState, env: CompletionEnv): CompletionResult;
  accept(result: CompletionResult, candidate: Candidate, mode?: AcceptMode): EditState;
  extendToCommon(result: CompletionResult): EditState | null;
  pressTab(tab: TabState, state: EditState, env: CompletionEnv, reverse?: boolean): TabStep;
  menuKey(tab: TabState, key: MenuKey): TabStep;
  /** The answer to `Display all N possibilities? (y or n)`. */
  answer(tab: TabState, yes: boolean): TabStep;
  ghostFor(state: EditState, result: CompletionResult | null, history: readonly string[], options?: GhostOptions): Ghost | null;
  applyGhost(state: EditState, ghost: Ghost, unit?: 'all' | 'word'): EditState;
  chipsFor(input: ChipInput): ChipList;
  /** The line a chip that edits makes; null for one that runs, stops or cancels. */
  applyChip(chip: Chip): EditState | null;
  /** What the list under the prompt shows for a Tab state. */
  tabView(tab: TabState): TabView;
}

export interface TabView {
  /** The listed candidates, or null when no list is open. */
  readonly result: CompletionResult | null;
  /** The menu's choice. */
  readonly highlight: number | null;
  /** `Display all N possibilities? (y or n)`. */
  readonly question: string | null;
}

export interface GhostOptions {
  /** Text is selected in the input. */
  readonly selection?: boolean;
  /** The Tab menu is open. */
  readonly menuOpen?: boolean;
}

/** The engine bound to one session's commands, files and history. */
export interface Completion {
  readonly engine: CompletionEngine;
  readonly env: CompletionEnv;
}

/** Idle: no Tab in progress. */
export const TAB_IDLE: TabState = { phase: 'idle' };

/** The line and cursor a Tab phase belongs to. */
export function tabKey(state: EditState): string {
  return `${state.text}\u0000${state.cursor}`;
}
