// The prompt (docs/plan/designs/terminal-input.md, "DOM STRATEGY", "EVENT ROUTING", "BUSY AND
// INTERRUPT"; 02, sections 5 and 12). One rune class owns the line being edited and everything
// around it: the Tab state, history stepping, reverse-i-search, the kill ring, the `> `
// continuation, a command reading a line (rm -i, sudo's password), and the running line. The
// completion result, the grey ghost and the chips are derived from it. The pure parts live in
// src/shell/editor and src/shell/complete; this class turns key presses into their actions and
// their results into writes to the real <input>, which stays the editing surface everywhere.
//
// - The input is never disabled. While a command runs, what is typed stays in it as type-ahead,
//   and Enter rings the bell instead of running it.
// - Enter commits the line at once: it leaves the input, and the shell puts it on the screen as
//   its entry, where the output streams in under it; preflight runs first, inside the key press
//   (so a URL can open).
// - ^C, Escape and the status line interrupt; the prompt returns at once, and the job's entry
//   ends in ^C.
// - Edits made here wait while an input method is composing, except a tapped chip, and are
//   dropped if what it commits is not the text they were made from.
// - A secret (sudo's password) never reaches the input's value: each key is taken in beforeinput
//   and kept here, and the input holds only as many bullets, so no screen reader, undo history
//   or copy can give it back. It never reaches history, the screen, storage or the kill ring,
//   and is emptied when the prompt loses focus or the page is hidden. Text an input method put
//   in the input itself goes with the input: a fresh one replaces it when the read ends.
// - Lines from history with line breaks in them (a quote continued at `> `) come back as typed:
//   their earlier lines at the `> ` prompt, the last in the input.

import type { Line } from '../../output/model';
import {
  TAB_IDLE,
  type Chip,
  type ChipList,
  type Completion,
  type CompletionResult,
  type EditState,
  type Ghost,
  type LastRun,
  type PromptMode,
  type TabState,
  type TabStep,
} from '../../shell/complete/types';
import { joinContinuation, type ContinuationReason } from '../../shell/editor/continuation';
import { NAV_IDLE, searchLabel, searchResult, startSearch, stepHistory, stepSearch, updateSearch, type HistoryNav, type SearchState } from '../../shell/editor/history';
import { chordOf, isModifierKey, resolveKey, type Action, type KeyChord, type KeyCtx, type KeyPlatform } from '../../shell/editor/keymap';
import { normalizePaste, normalizeTyped } from '../../shell/editor/normalize';
import { EMPTY_RING, applyOp, replaceRange, settleRing, yankLastArg, type EditOp, type KillRing, type LastArgState } from '../../shell/editor/readline';
import type { AppRequest, JobOrigin, ReadRequest, ShellPort, StartOptions } from '../../shell/index';
import type { ExitCode, JobInfo } from '../../shell/types';
import type { ScreenStore } from '../../stores/screen';
import { REVEAL_EVENT, SUBMIT_EVENT } from '../actions/stickToBottom';
import { diffRange, writeInput } from './inputDom';
import { secretEdit, secretMerge } from './secret';

/** Escape, then Tab within this long, leaves the terminal (F095). */
export const ESCAPE_TAB_MS = 1000;
/** The visual bell: the prompt's underline flashes this long. */
export const BELL_MS = 150;
/** The cursor holds still this long after an edit, then blinks. */
export const STEADY_MS = 600;

/** The id of a read the prompt asks itself: the Tab list's `Display all N possibilities?`. */
const OWN_READ = -1;

/** The element with a read's dim hint (PromptLine), which describes the input (LineEditor). */
export const READ_HINT_ID = 'prompt-read-hint';

/** What the input shows for each character of a secret. */
export const SECRET_MASK = '•';

const EMPTY_LINE: EditState = { text: '', cursor: 0 };

/** The keys on the phone dock's key bar that do what the same key on a keyboard does. */
export type DockKey = 'Tab' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Escape';

/** A key press: a KeyboardEvent, or one the dock's key bar makes. */
type KeyPress = KeyChord & { readonly defaultPrevented: boolean; preventDefault(): void };

/** The key press a dock key stands for. */
function dockKeyPress(key: DockKey): KeyPress {
  return {
    key,
    code: key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    preventDefault: () => {},
  };
}

export interface PromptDeps {
  readonly shell: ShellPort;
  /** The transcript: an empty Enter and an abandoned line go here, and Ctrl+L clears it. */
  readonly screen: Pick<ScreenStore, 'push' | 'clear'>;
  /** Which readline keys are free: Ctrl+W and friends only on a Mac. */
  readonly platform: KeyPlatform;
  /** A touch screen: the native input shows, with no mirror, and focus waits for a tap. */
  readonly touch: boolean;
  /**
   * The phone dock is showing (a touch screen, or ?dock=1): the chips are a thumb's, with the
   * starters, the follow-ups, a run in one tap and Stop, and they are drawn in the dock.
   */
  readonly dock?: boolean;
  readonly now?: () => number;
}

/** A line a command, or the prompt itself, is waiting for. */
export interface PromptRead {
  readonly id: number;
  /** Where PS1 would be: `[sudo] password for guest: `. */
  readonly prompt: string;
  readonly secret: boolean;
  /** A dim line above the prompt. */
  readonly hint: string | null;
  /** The first key answers: `Display all N possibilities? (y or n)`. */
  readonly oneKey: boolean;
  /** The line being edited stays, and the question shows under it. */
  readonly keepLine: boolean;
}

interface ActiveRead extends PromptRead {
  readonly answer: (text: string | null) => void;
  /** What was on the prompt when the read began, put back when it ends. */
  readonly stash: EditState | null;
  /** For a one-key question: the line it was asked over, which a typed answer must not change. */
  readonly asked: EditState | null;
}

/** The line that is running, frozen at the prompt it was typed at. */
export interface RunningLine {
  readonly line: string;
  readonly prompt: Line;
}

/** Lines collected at the `> ` prompt until the whole is complete. */
export interface Continuation {
  /** The lines so far, joined as the shell will run them. */
  readonly text: string;
  readonly reason: ContinuationReason;
  /** The lines as typed, for the screen. */
  readonly lines: readonly string[];
  /** The prompt the first line was typed at. */
  readonly prompt: Line;
}

interface WriteOptions {
  /** A Tab press made this edit: its state stays. */
  readonly keepTab?: boolean;
  /** A history step made it: stepping goes on from there. */
  readonly keepNav?: boolean;
  /** Alt+. made it: pressing it again swaps in an older argument. */
  readonly keepLastArg?: boolean;
  /** Undo cannot bring it back, and the browser's undo history goes: a secret, a submitted line. */
  readonly replace?: boolean;
  /** Even mid-composition: a tapped chip commits what the keyboard was composing. */
  readonly force?: boolean;
}

/** An edit that waits for the input method to finish composing. */
interface PendingWrite {
  readonly state: EditState;
  readonly options: WriteOptions;
  /** The text it was made from: if the composition commits anything else, it is dropped. */
  readonly base: string;
  /** The Tab state it leads to, set when it lands. */
  readonly tab: TabState | null;
}

export class PromptController {
  // ── State ────────────────────────────────────────────────────────────────────────────────
  text = $state('');
  cursor = $state(0);
  /** The other end of the selection; equal to cursor when nothing is selected. */
  selEnd = $state(0);
  focused = $state(false);
  // Raw: each is replaced, never changed in place, and output blocks must keep their identity,
  // which is how OutputView knows a tappable action was made by trusted code.
  tab = $state.raw<TabState>(TAB_IDLE);
  nav = $state.raw<HistoryNav>(NAV_IDLE);
  search = $state.raw<SearchState | null>(null);
  ps2 = $state.raw<Continuation | null>(null);
  running = $state.raw<RunningLine | null>(null);
  job = $state.raw<JobInfo | null>(null);
  read = $state.raw<ActiveRead | null>(null);
  completion = $state.raw<Completion | null>(null);
  /** A full-screen app is over the terminal (the Shutdown screen): it has the keys. */
  app = $state.raw<AppRequest | null>(null);
  history = $state.raw<readonly string[]>([]);
  lastStatus = $state<ExitCode>(0);
  /** The line that ran last at this prompt, for the chips that follow it. */
  last = $state.raw<LastRun | null>(null);
  /** The visual bell is showing. */
  bell = $state(false);
  /** For the polite live region; a no-break space alternates so a repeat is announced again. */
  announce = $state('');
  /** When the line last changed, for the cursor that holds still while typing. */
  editedAt = $state(0);
  /** Goes up when the <input> must be replaced by a fresh one (LineEditor keys it on this). */
  inputEpoch = $state(0);

  readonly platform: KeyPlatform;
  readonly touch: boolean;
  readonly dock: boolean;
  /** The kill ring; never holds a secret. */
  ring: KillRing = EMPTY_RING;
  /** The mirror's ghost, for a tap on it; LineEditor sets it. */
  ghostElement: HTMLElement | null = null;

  private readonly shell: ShellPort;
  private readonly screen: PromptDeps['screen'];
  private readonly now: () => number;
  private input: HTMLInputElement | null = null;
  private suppress = false;
  private composing = false;
  private pendingWrite: PendingWrite | null = null;
  private escapedAt = Number.NEGATIVE_INFINITY;
  /** sudo's password as typed. The input only ever holds SECRET_MASK for each character. */
  private secret = '';
  /** Text an input method composed reached the input during a secret read (or was typed ahead of it). */
  private secretExposed = false;
  /** The input being replaced had focus: the new one takes it. */
  private refocusNext = false;
  /** Unwires the input now attached. */
  private detachInput: (() => void) | null = null;
  /** The line being typed before Up first went into history; Down brings it back (F069). */
  private historyDraft: EditState | null = null;
  /** The `> ` lines are a recalled history line's, standing in for these (null: none). */
  private recalled: { readonly base: Continuation | null } | null = null;
  /** The last reverse-i-search query, which Ctrl+R on an empty search looks for again. */
  private lastQuery = '';
  private lastArg: LastArgState | null = null;
  private runs = 0;
  private announced = 0;
  private bellTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly stops: (() => void)[] = [];

  constructor(deps: PromptDeps) {
    this.shell = deps.shell;
    this.screen = deps.screen;
    this.platform = deps.platform;
    this.touch = deps.touch;
    this.dock = deps.dock ?? false;
    this.now = deps.now ?? (() => (typeof performance === 'undefined' ? Date.now() : performance.now()));
    this.stops.push(
      deps.shell.completion.subscribe((value) => (this.completion = value)),
      deps.shell.lastStatus.subscribe((value) => (this.lastStatus = value)),
      deps.shell.historyLines.subscribe((value) => (this.history = value)),
      // The prompt is idle again the moment the job ends, in the same update as its entry.
      deps.shell.job.subscribe((value) => {
        this.job = value;
        if (value === null) this.running = null;
      }),
      deps.shell.reads.subscribe((request) => this.onShellRead(request)),
      deps.shell.apps.subscribe((request) => (this.app = request)),
    );
  }

  // ── Derived ──────────────────────────────────────────────────────────────────────────────

  /** What the prompt is doing: typing, a command running, a password, a history search. */
  get mode(): PromptMode {
    if (this.read?.secret === true) return 'secret';
    if (this.search !== null) return 'search';
    if (this.running !== null && this.read === null) return 'busy';
    return 'edit';
  }

  /** The line and cursor. */
  get state(): EditState {
    return { text: this.text, cursor: Math.min(this.cursor, this.text.length) };
  }

  /** The completion of the line, while it is being typed. */
  readonly result = $derived.by((): CompletionResult | null => {
    const completion = this.completion;
    if (completion === null || this.mode !== 'edit' || this.read !== null || this.ps2 !== null) return null;
    return completion.engine.complete(this.state, completion.env);
  });

  /** The grey text after the cursor: the rest of a history line, or of the completion. */
  readonly ghost = $derived.by((): Ghost | null => {
    const completion = this.completion;
    if (completion === null || this.touch || this.mode !== 'edit' || this.read !== null || this.ps2 !== null) return null;
    return completion.engine.ghostFor(this.state, this.result, this.history, {
      selection: this.selEnd !== this.cursor,
      menuOpen: this.tab.phase === 'menu',
    });
  });

  /**
   * The chips: completions, the Tab list, did-you-mean and Cancel; in the dock also the starters,
   * the follow-ups, the line ready to run and Stop.
   */
  readonly chipList = $derived.by((): ChipList => {
    const completion = this.completion;
    if (completion === null || this.ps2 !== null || (this.read !== null && !this.read.secret && !this.read.keepLine)) return { chips: [], more: 0 };
    const thumb = this.touch || this.dock;
    const list = completion.engine.chipsFor({
      mode: this.mode,
      state: this.state,
      result: this.result,
      tab: this.tab,
      touch: thumb,
      registry: completion.env.registry,
      history: this.history,
      max: thumb ? 24 : 8,
      lastStatus: this.lastStatus,
      last: this.last,
      env: completion.env,
    });
    if (this.dock) return list;
    // Under the prompt, the status line already stops a running command.
    return { chips: list.chips.filter((chip) => chip.action.kind !== 'interrupt'), more: list.more };
  });

  /** What the status line shows while a line runs: the line, its label, when it started. */
  readonly status = $derived.by((): { line: string; label: string | null; startedAt: number } | null => {
    const running = this.running;
    if (running === null || this.read !== null) return null;
    return { line: running.line, label: this.job?.label ?? null, startedAt: this.job?.startedAt ?? 0 };
  });

  /** The Tab list is open, rather than the quiet row shown while typing. */
  readonly listed = $derived(this.completion?.engine.tabView(this.tab).result != null);

  /** `Display all N possibilities? (y or n)` while it waits for an answer. */
  readonly question = $derived(this.read?.keepLine === true ? this.read.prompt : null);

  /** What the search shows: `(reverse-i-search)`, the query, then the line found. */
  readonly searchView = $derived.by(() => {
    const search = this.search;
    if (search === null) return null;
    const hit = search.hit;
    return { label: searchLabel(search), line: hit?.line ?? '', at: hit?.at ?? 0, length: hit === null ? 0 : search.query.length };
  });

  // ── The input ────────────────────────────────────────────────────────────────────────────

  /** Wires the prompt to its input. Returns a function that unwires it. */
  attach(input: HTMLInputElement): () => void {
    this.input = input;
    writeInput(input, this.state, { undoable: false });
    this.focused = input.ownerDocument.activeElement === input;
    // A fresh input in place of one that had focus (after a password): the caret stays here.
    if (this.refocusNext) {
      this.refocusNext = false;
      input.focus({ preventScroll: true });
      this.focused = input.ownerDocument.activeElement === input;
    }
    const win = input.ownerDocument.defaultView;
    const off: (() => void)[] = [];
    const on = <K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
      input.addEventListener(type, listener);
      off.push(() => input.removeEventListener(type, listener));
    };
    on('keydown', (event) => this.onKeydown(event));
    on('beforeinput', (event) => this.onBeforeInput(event));
    on('input', () => this.onInput());
    on('paste', (event) => this.onPaste(event));
    on('compositionstart', () => {
      this.composing = true;
    });
    on('compositionend', () => this.onCompositionEnd());
    on('select', () => this.syncSelection());
    // Where the browser sends selectionchange to the input itself; keyup and pointerup cover the rest.
    input.addEventListener('selectionchange', this.onSelectionChange);
    off.push(() => input.removeEventListener('selectionchange', this.onSelectionChange));
    on('keyup', () => this.syncSelection());
    on('pointerup', (event) => this.onPointerUp(event));
    on('focus', () => {
      this.focused = true;
      this.syncSelection();
    });
    on('blur', () => {
      this.focused = false;
      // A password typed and left is not left lying in the page.
      if (this.mode === 'secret') this.clearSecret();
    });
    if (win) {
      const onPageHide = (): void => {
        if (this.mode === 'secret') this.clearSecret();
      };
      const onWindowKey = (event: KeyboardEvent): void => this.onWindowKey(event);
      win.addEventListener('pagehide', onPageHide);
      win.addEventListener('keydown', onWindowKey);
      off.push(() => {
        win.removeEventListener('pagehide', onPageHide);
        win.removeEventListener('keydown', onWindowKey);
      });
    }
    const detach = (): void => {
      for (const stop of off.splice(0)) stop();
      if (this.input === input) this.input = null;
      if (this.detachInput === detach) this.detachInput = null;
    };
    this.stops.push(detach);
    this.detachInput = detach;
    return detach;
  }

  /** The input, for the focus policy. */
  get element(): HTMLInputElement | null {
    return this.input;
  }

  /**
   * Focuses the prompt without scrolling: on a desktop always; on touch, where focus opens the
   * keyboard, only with `keyboard`. Call it inside the tap, the only time iOS lets focus open it.
   */
  focus(options: { keyboard?: boolean } = {}): void {
    if (options.keyboard === true || !this.touch) this.input?.focus({ preventScroll: true });
  }

  /**
   * Brings the prompt into view, however far up the visitor had scrolled: the transcript goes to
   * its end (ui/actions/stickToBottom.ts). For a tap that opens the keyboard to type.
   */
  reveal(): void {
    this.input?.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
  }

  destroy(): void {
    for (const stop of this.stops.splice(0)) stop();
    clearTimeout(this.bellTimer);
    this.input = null;
  }

  private onSelectionChange = (): void => this.syncSelection();

  /** Reads the caret and selection back from the input after the browser moved them. */
  private syncSelection(): void {
    const input = this.input;
    if (input === null || this.suppress) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const backward = input.selectionDirection === 'backward';
    this.cursor = backward ? start : end;
    this.selEnd = backward ? end : start;
  }

  private adopt(): void {
    const input = this.input;
    if (input === null) return;
    this.text = input.value;
    this.syncSelection();
  }

  /** Puts a line on the prompt: into the input, and into the state. */
  private write(next: EditState, options: WriteOptions = {}, tab: TabState | null = null): void {
    if (this.composing && options.force !== true) {
      this.pendingWrite = { state: next, options, base: this.text, tab };
      return;
    }
    // Whatever waited for the composition is overtaken by this.
    this.pendingWrite = null;
    if (options.force === true) this.composing = false;
    const before = this.text;
    const input = this.input;
    if (input !== null) {
      this.suppress = true;
      try {
        writeInput(input, next, { undoable: options.replace !== true && this.mode !== 'secret' });
      } finally {
        this.suppress = false;
      }
    }
    this.text = next.text;
    this.cursor = Math.min(next.cursor, next.text.length);
    this.selEnd = this.cursor;
    this.changed(options, this.text !== before);
  }

  /** What follows any change to the line, typed or made here; `edited` when its text changed. */
  private changed(options: WriteOptions, edited: boolean): void {
    if (options.keepTab !== true && this.tab.phase !== 'idle') this.tab = TAB_IDLE;
    // Moving the cursor is not editing: Up and Down go on from where they were, as in bash.
    if (options.keepNav !== true && edited) this.nav = NAV_IDLE;
    if (options.keepLastArg !== true) this.lastArg = null;
    if (this.search !== null && edited) this.search = updateSearch(this.history, this.search, this.text);
    this.editedAt = this.now();
  }

  private onInput(): void {
    if (this.suppress || this.input === null) return;
    const read = this.read;
    if (read?.oneKey === true && read.asked !== null) {
      // A soft keyboard that composes every word (Gboard) types the answer with no usable key
      // press: the line goes back to what it was, and the first character typed answers.
      const value = this.input.value;
      if (value !== read.asked.text) {
        const { insert } = diffRange(read.asked.text, value);
        this.write(read.asked, { replace: true, force: true, keepTab: true });
        this.answerQuestion(insert === '' ? 'Backspace' : (Array.from(insert)[0] ?? ''));
      }
      return;
    }
    if (this.mode === 'secret') {
      // Typing never gets here (onBeforeInput takes it); an input method's composition, or an
      // undo, does. Once the composition is done, what it added joins the password and the input
      // is masked again.
      if (this.composing) this.secretExposed = true;
      else this.reconcileSecret();
      return;
    }
    const before = this.text;
    this.adopt();
    this.ring = settleRing(this.ring);
    if (!this.composing) {
      const plain = normalizeTyped(this.text);
      if (plain !== this.text) {
        this.write({ text: plain, cursor: normalizeTyped(this.text.slice(0, this.cursor)).length });
        return;
      }
    }
    // A composition that ends with the line as it was (one the prompt ended itself) changes
    // nothing: the Tab list it may have just opened stays.
    if (this.text !== before) this.changed({}, true);
  }

  private onCompositionEnd(): void {
    this.composing = false;
    const pending = this.pendingWrite;
    this.pendingWrite = null;
    this.onInput();
    // An edit made while composing (a dock key) lands now, unless the input method committed
    // something other than the text it was made from.
    if (pending === null || pending.base !== this.text) return;
    this.write(pending.state, pending.options);
    if (pending.tab !== null) this.tab = pending.tab;
  }

  private onBeforeInput(event: InputEvent): void {
    // A soft keyboard answers `Display all N possibilities?` by typing, with no usable keydown.
    if (this.read?.oneKey === true) {
      if (event.inputType === 'insertText' && event.data) {
        event.preventDefault();
        this.answerQuestion(event.data.charAt(0));
        return;
      }
      if (event.inputType.startsWith('delete') && event.cancelable) {
        event.preventDefault();
        this.answerQuestion('Backspace');
        return;
      }
    }
    // Some Android keyboards send Enter only as a line break.
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault();
      this.submit();
      return;
    }
    if (this.mode === 'secret') {
      this.secretBeforeInput(event);
      return;
    }
    if (event.inputType === 'insertFromPaste' && event.dataTransfer) {
      const pasted = event.dataTransfer.getData('text/plain');
      if (pasted !== '') {
        event.preventDefault();
        this.paste(pasted);
      }
    }
  }

  private onPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text/plain');
    if (pasted === undefined || pasted === '') return;
    event.preventDefault();
    this.paste(pasted);
  }

  /** Pasted text, made one line that never runs by itself, at the selection. */
  private paste(pasted: string): void {
    const from = Math.min(this.cursor, this.selEnd);
    const to = Math.max(this.cursor, this.selEnd);
    if (this.mode === 'secret') {
      this.setSecret(replaceRange(this.secretState(), from, to, pasted.replace(/[\r\n]+/g, '')));
      return;
    }
    this.ring = settleRing(this.ring);
    this.write(replaceRange(this.state, from, to, normalizePaste(pasted)));
  }

  // ── The secret ───────────────────────────────────────────────────────────────────────────

  /** The password and the cursor in it (the mask's cursor: one bullet per UTF-16 unit). */
  private secretState(): EditState {
    return { text: this.secret, cursor: Math.min(this.cursor, this.secret.length) };
  }

  /** The password is now `next`: kept here, and only its mask written to the input. */
  private setSecret(next: EditState): void {
    this.secret = next.text;
    this.write({ text: SECRET_MASK.repeat(next.text.length), cursor: next.cursor }, { replace: true, force: true });
  }

  /** Empties the password: the prompt lost focus, the page was hidden. */
  private clearSecret(): void {
    this.setSecret(EMPTY_LINE);
    // An input method left text in the input, where its undo history can find it.
    if (this.secretExposed) this.replaceInput();
  }

  /** The read is over: the password goes, and so does an input an input method typed it into. */
  private endSecret(): void {
    this.secret = '';
    if (this.secretExposed) this.replaceInput();
  }

  /**
   * Puts a fresh <input> in place of this one, whose undo history may hold text from the
   * password (Cmd+Z after a cleared value brings it back in Chromium). The caret moves with it.
   */
  private replaceInput(): void {
    this.secretExposed = false;
    const input = this.input;
    this.refocusNext = input !== null && input.ownerDocument.activeElement === input;
    // Unwired now, so the blur a browser fires as it goes is not heard while Svelte replaces it.
    this.detachInput?.();
    this.inputEpoch += 1;
  }

  /**
   * A key typed, pasted, dropped or deleted while the password is read: done here to the
   * password, so it never reaches the input's value, where screen readers read it out and undo
   * keeps it. An input method's text cannot be stopped; onInput takes it when the composition ends.
   */
  private secretBeforeInput(event: InputEvent): void {
    const type = event.inputType;
    if (type === 'insertCompositionText' || type === 'deleteCompositionText' || type === 'insertFromComposition' || !event.cancelable) return;
    event.preventDefault();
    const input = this.input;
    if (input === null) return;
    const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
    const start = input.selectionStart ?? this.secret.length;
    const next = secretEdit(type, data, this.secret, start, input.selectionEnd ?? start);
    if (next !== null) this.setSecret(next);
  }

  /** The input changed under the mask (an input method, an undo): the password takes what was added. */
  private reconcileSecret(): void {
    const input = this.input;
    if (input === null || input.value === this.text) return;
    const merged = secretMerge(this.secret, this.text, input.value, SECRET_MASK);
    if (merged.added) this.secretExposed = true;
    this.setSecret(merged.state);
  }

  private onPointerUp(event: PointerEvent): void {
    this.syncSelection();
    // A tap or click on the grey ghost takes it. The input lies over the mirror, so the ghost is
    // found by where the pointer was.
    const ghost = this.ghost;
    const element = this.ghostElement;
    if (ghost === null || !ghost.acceptable || element === null) return;
    const box = element.getBoundingClientRect();
    if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) {
      this.acceptGhost('all');
    }
  }

  /** ^C or Escape while a command runs, with focus somewhere else on the page. */
  private onWindowKey(event: KeyboardEvent): void {
    if (event.target === this.input || event.defaultPrevented || this.app !== null) return;
    if (this.running === null && this.read === null) return;
    // On a Mac, Cmd+C copies, so Ctrl+C always interrupts, as in Terminal.
    const ctrlC = chordOf(event) === 'C-c' && (this.platform === 'mac' || !this.hasSelection());
    if (event.key === 'Escape' || ctrlC) {
      event.preventDefault();
      this.interrupt();
    }
  }

  /** Text is selected, in the prompt or in the page: Ctrl+C copies it. */
  hasSelection(): boolean {
    const input = this.input;
    const doc = input?.ownerDocument;
    if ((doc?.defaultView?.getSelection()?.toString() ?? '') !== '') return true;
    return input !== null && doc?.activeElement === input && input.selectionStart !== null && input.selectionStart !== input.selectionEnd;
  }

  // ── Keys ─────────────────────────────────────────────────────────────────────────────────

  private context(): KeyCtx {
    return {
      mode: this.mode,
      platform: this.platform,
      atEnd: this.cursor >= this.text.length && this.selEnd === this.cursor,
      empty: this.text === '',
      hasGhost: this.ghost?.acceptable === true,
      hasSelection: this.hasSelection(),
      escArmed: this.now() - this.escapedAt <= ESCAPE_TAB_MS,
    };
  }

  private onKeydown(event: KeyboardEvent): void {
    this.handleKey(event);
  }

  /** A key press on the prompt, or on the dock's key bar. Returns what it did, or null. */
  private handleKey(event: KeyPress): Action | null {
    if (event.defaultPrevented) return null;
    // `Display all N possibilities?` takes every key but the browser's own Cmd shortcuts.
    if (this.read?.oneKey === true && !event.isComposing && event.keyCode !== 229 && !event.metaKey && !isModifierKey(event.key)) {
      event.preventDefault();
      this.answerQuestion(event.key, chordOf(event));
      return null;
    }
    this.syncSelection();
    const ctx = this.context();
    if (!isModifierKey(event.key)) this.escapedAt = Number.NEGATIVE_INFINITY;
    const action = this.metaAfterEscape(event, ctx) ?? resolveKey(event, ctx);

    // In the Tab menu, a key other than Tab or Escape keeps the choice on the line and carries
    // on; Enter takes the choice without running it.
    if (this.tab.phase === 'menu' && action.a !== 'tab' && action.a !== 'escape' && action.a !== 'leave' && !isModifierKey(event.key)) {
      const engine = this.completion?.engine;
      if (engine !== undefined) this.applyTab(engine.menuKey(this.tab, action.a === 'submit' ? 'enter' : 'commit'));
      if (action.a === 'submit') {
        event.preventDefault();
        return action;
      }
    }
    this.perform(action, event);
    return action;
  }

  /**
   * Escape, then a key within ESCAPE_TAB_MS, is that key with Alt, as readline reads it: Esc .
   * inserts the last argument, Esc b goes back a word, where Option is not Meta. Only a key the
   * Alt chord is bound to; Tab after Escape still leaves the terminal.
   */
  private metaAfterEscape(event: KeyPress, ctx: KeyCtx): Action | null {
    if (!ctx.escArmed || event.key === 'Tab' || event.key === 'Escape' || event.ctrlKey || event.altKey || event.metaKey || isModifierKey(event.key)) return null;
    const meta: KeyChord = {
      key: event.key,
      code: event.code,
      ctrlKey: false,
      altKey: true,
      metaKey: false,
      shiftKey: event.shiftKey,
      isComposing: event.isComposing,
      keyCode: event.keyCode,
    };
    const action = resolveKey(meta, ctx);
    return action.a === 'native' ? null : action;
  }

  /**
   * A key on the dock's key bar: exactly what the same key on a keyboard does at the prompt, so
   * tab completes, lists and cycles, and the arrows walk history. ← and → move the cursor.
   */
  pressKey(key: DockKey): void {
    this.syncSelection();
    const action = this.handleKey(dockKeyPress(key));
    // A keyboard's own arrows move the caret themselves; a key bar's do it here.
    if (action?.a === 'native' && (key === 'ArrowLeft' || key === 'ArrowRight')) this.editOp(key === 'ArrowLeft' ? 'charLeft' : 'charRight');
    // Escape on the key bar never arms Escape-then-Tab, which is for leaving with a keyboard.
    if (key === 'Escape') this.escapedAt = Number.NEGATIVE_INFINITY;
  }

  /** Text from the dock's symbols, at the cursor, over any selection, as if typed. */
  insertText(text: string): void {
    this.syncSelection();
    const from = Math.min(this.cursor, this.selEnd);
    const to = Math.max(this.cursor, this.selEnd);
    if (this.mode === 'secret') {
      this.setSecret(replaceRange(this.secretState(), from, to, text));
      return;
    }
    this.ring = settleRing(this.ring);
    this.write(replaceRange(this.state, from, to, text), { force: true });
  }

  /** Puts the keyboard away: the ⌄ key. */
  blur(): void {
    this.input?.blur();
  }

  private perform(action: Action, event: KeyPress): void {
    switch (action.a) {
      case 'native':
        return;
      case 'leave':
        // Focus moves on to the rest of the page, as Tab does anywhere else.
        this.resetTab();
        return;
      case 'submit':
        event.preventDefault();
        this.submit();
        return;
      case 'tab':
        // Held even while a command runs, so focus stays in the prompt.
        event.preventDefault();
        this.pressTab(action.reverse);
        return;
      case 'op':
        event.preventDefault();
        this.editOp(action.op);
        return;
      case 'acceptGhost':
        event.preventDefault();
        this.acceptGhost(action.unit);
        return;
      case 'history':
        event.preventDefault();
        this.stepHistory(action.dir);
        return;
      case 'search':
        event.preventDefault();
        this.stepSearch(action.dir);
        return;
      case 'searchAccept':
        event.preventDefault();
        this.searchAccept();
        return;
      case 'searchExit': {
        this.searchExit();
        // Then the key does what it does on the line found. Ctrl+J only ends the search (and is
        // never the browser's).
        const next = resolveKey(event, this.context());
        if (next.a === 'native' && event.ctrlKey) event.preventDefault();
        else if (next.a !== 'searchExit') this.perform(next, event);
        return;
      }
      case 'searchCancel':
        event.preventDefault();
        this.searchCancel();
        return;
      case 'yankLastArg':
        event.preventDefault();
        this.insertLastArg();
        return;
      case 'interrupt':
        event.preventDefault();
        this.interrupt();
        return;
      case 'clearScreen':
        event.preventDefault();
        this.clearScreen();
        return;
      case 'escape':
        this.escape(event);
        return;
      case 'eof':
        event.preventDefault();
        this.eof();
        return;
    }
  }

  private escape(event: KeyPress): void {
    const engine = this.completion?.engine;
    if (this.tab.phase === 'menu' && engine !== undefined) {
      // The menu closes and what was typed before it comes back.
      event.preventDefault();
      this.applyTab(engine.menuKey(this.tab, 'escape'));
      return;
    }
    if (this.tab.phase === 'listed') {
      event.preventDefault();
      this.resetTab();
      return;
    }
    if (this.running !== null || this.read !== null) {
      event.preventDefault();
      this.interrupt();
      return;
    }
    // Tab within a second leaves the terminal.
    this.escapedAt = this.now();
  }

  // ── Editing ──────────────────────────────────────────────────────────────────────────────

  private editOp(op: EditOp): void {
    if (this.mode === 'secret') {
      // On the password itself, not its mask. It never enters the kill ring, and nothing comes
      // out of the ring into it.
      this.setSecret(applyOp(this.secretState(), op, EMPTY_RING).state);
      return;
    }
    const { state, ring } = applyOp(this.state, op, this.ring);
    this.ring = ring;
    this.write(state);
  }

  /** Right or End at the end of the line: the grey text, all of it or its next word. */
  acceptGhost(unit: 'all' | 'word' = 'all'): void {
    const ghost = this.ghost;
    const engine = this.completion?.engine;
    if (ghost === null || engine === undefined) return;
    this.ring = settleRing(this.ring);
    this.write(engine.applyGhost(this.state, ghost, unit));
  }

  private stepHistory(dir: -1 | 1): void {
    // A command's own prompt has no history.
    if (this.read !== null) return;
    const whole = this.wholeState();
    if (dir === 1 && this.nav.index === null) {
      // Down from a line edited on the way: back to what was being typed before Up.
      const draft = this.historyDraft;
      if (draft === null || draft.text === whole.text) return;
      this.historyDraft = null;
      this.ring = settleRing(this.ring);
      this.recall(draft, { replace: true });
      return;
    }
    const step = stepHistory(this.history, this.nav, whole, dir);
    if (step === null) return;
    if (this.nav.index === null && this.historyDraft === null) this.historyDraft = whole;
    this.ring = settleRing(this.ring);
    this.recall(step.state, { keepNav: true, replace: true });
    this.nav = step.nav;
    if (step.nav.index === null && step.state.text === this.historyDraft?.text) this.historyDraft = null;
  }

  /** The line as it will run: a recalled line's `> ` lines, then the input's. */
  private wholeState(): EditState {
    const ps2 = this.ps2;
    if (this.recalled === null || ps2 === null) return this.state;
    return { text: `${ps2.text}\n${this.text}`, cursor: ps2.text.length + 1 + this.state.cursor };
  }

  /**
   * Puts a line from history on the prompt. One with line breaks (a quote continued at `> `)
   * comes back as it was typed: its earlier lines above, at the `> ` prompt, and its last in the
   * input, which holds one line; Enter joins them back into exactly the line that ran. Any `> `
   * lines it covers come back with a line that has none.
   */
  private recall(next: EditState, options: WriteOptions): void {
    const base = this.recalled === null ? this.ps2 : this.recalled.base;
    const lines = next.text.split(/\r?\n/);
    if (lines.length === 1) {
      this.ps2 = base;
      this.recalled = null;
      this.write(next, options);
      return;
    }
    const head = lines.slice(0, -1);
    const last = lines[lines.length - 1] ?? '';
    const offset = next.text.length - last.length;
    this.ps2 = { text: head.join('\n'), reason: 'quote', lines: head, prompt: base?.prompt ?? this.shell.renderPrompt() };
    this.recalled = { base };
    this.write({ text: last, cursor: Math.max(0, next.cursor - offset) }, options);
  }

  private insertLastArg(): void {
    if (this.read !== null) return;
    const inserted = yankLastArg(this.state, this.history, this.lastArg);
    if (inserted === null) return;
    this.write(inserted.state, { keepLastArg: true });
    this.lastArg = inserted.inserted;
  }

  // ── Reverse-i-search ─────────────────────────────────────────────────────────────────────

  private stepSearch(dir: -1 | 1): void {
    if (this.read !== null) return;
    const search = this.search;
    if (search === null) {
      if (dir === 1) return;
      this.resetTab();
      // The input holds the query from here; the line typed so far is kept to come back to.
      const saved = this.state;
      this.search = startSearch(saved);
      this.write({ text: '', cursor: 0 }, { replace: true });
      return;
    }
    if (search.query === '' && this.lastQuery !== '') {
      // Ctrl+R with nothing typed: the last search again, as bash does.
      this.write({ text: this.lastQuery, cursor: this.lastQuery.length }, { replace: true });
      return;
    }
    this.search = stepSearch(this.history, search, dir);
  }

  /** The search is over: its query is kept for Ctrl+R on an empty search. */
  private endSearch(search: SearchState): void {
    this.search = null;
    if (search.query !== '') this.lastQuery = search.query;
  }

  /** Enter in a search: the line found runs. */
  private searchAccept(): void {
    const search = this.search;
    if (search === null) return;
    this.endSearch(search);
    this.recall(searchResult(search), { replace: true });
    this.submit();
  }

  /** A moving or editing key in a search: the line found goes on the prompt to be edited. */
  private searchExit(): void {
    const search = this.search;
    if (search === null) return;
    this.endSearch(search);
    this.recall(searchResult(search), { replace: true });
    // Up and Down go on from the line found.
    if (search.hit !== null) this.nav = { index: search.hit.index, prefix: '', draft: search.saved };
  }

  private searchCancel(): void {
    const search = this.search;
    if (search === null) return;
    this.endSearch(search);
    this.write(search.saved, { replace: true });
  }

  // ── Tab and the chips ────────────────────────────────────────────────────────────────────

  /** Tab, or Shift+Tab: extend, then list, then a menu that cycles (02, section 5). */
  pressTab(reverse = false): void {
    const completion = this.completion;
    if (completion === null || this.read !== null || this.search !== null || this.running !== null) return;
    // The `> ` continuation completes nothing (no ghost, no chips): Tab says so, never acts unseen.
    if (this.ps2 !== null) {
      this.ringBell();
      return;
    }
    this.applyTab(completion.engine.pressTab(this.tab, this.state, completion.env, reverse));
  }

  private resetTab(): void {
    if (this.tab.phase !== 'idle') this.tab = TAB_IDLE;
  }

  private applyTab(step: TabStep): void {
    const effect = step.effect;
    if (effect.edit !== undefined && this.composing) {
      // The input method is still composing (a dock key): the edit, and the Tab state it leads
      // to, wait for it, and are dropped if it commits anything but the text they came from.
      this.write(effect.edit, { keepTab: true }, step.tab);
      return;
    }
    this.tab = step.tab;
    if (effect.edit !== undefined) this.write(effect.edit, { keepTab: true });
    if (effect.bell === true) this.ringBell();
    if (effect.announce !== undefined) this.say(effect.announce);
    const asking = step.tab;
    if (asking.phase === 'asking') {
      const engine = this.completion?.engine;
      this.beginRead(
        { id: OWN_READ, prompt: effect.question ?? '', secret: false, hint: null, oneKey: true, keepLine: true },
        (answer) => {
          if (engine !== undefined) this.applyTab(engine.answer(asking, answer === 'y'));
        },
      );
    }
  }

  /**
   * A tapped or clicked chip: an edit goes on the line exactly as Tab would put it there, and
   * focus stays on the prompt, so a phone's keyboard stays up; a chip that runs (a starter, a
   * follow-up, a candidate that finishes the line) runs, and leaves the keyboard as it was; Stop
   * and Cancel interrupt. With `insert` (a long press), a chip that runs only edits: its line
   * goes on the prompt, and the keyboard opens to change it.
   */
  choose(chip: Chip, options: { readonly insert?: boolean } = {}): void {
    const action = chip.action;
    const insert = options.insert === true;
    if (action.kind === 'apply') {
      const edit = this.completion?.engine.applyChip(chip) ?? null;
      this.resetTab();
      if (action.run === true && !insert && chip.line !== undefined) {
        this.submit(chip.line, 'chip');
        this.focus();
        return;
      }
      if (edit !== null) this.write(edit, { force: true });
      this.input?.focus({ preventScroll: true });
    } else if (action.kind === 'run') {
      this.resetTab();
      if (insert) {
        if (chip.kind !== 'current') this.insert(action.line);
        this.focus({ keyboard: true });
        return;
      }
      this.submit(action.line, 'chip');
      this.focus();
    } else {
      this.interrupt();
    }
  }

  /**
   * The line at the prompt, for the session snapshot: what is typed (or typed ahead), and null
   * while it holds a secret or answers a command's question, which are never kept.
   */
  snapshotLine(): string | null {
    if (this.read !== null || this.mode === 'secret') return null;
    return this.text;
  }

  /** Puts a line back at the prompt without running it or scrolling: after Back. */
  restoreLine(text: string): void {
    if (this.read !== null || /[\r\n]/.test(text)) return;
    this.write({ text, cursor: text.length }, { replace: true, force: true });
  }

  /** Puts text at the prompt, for a tapped name that inserts rather than runs. */
  insert(text: string): void {
    this.resetTab();
    this.search = null;
    this.recall({ text, cursor: text.length }, { force: true });
    // As typing would, the transcript brings the prompt into view.
    this.reveal();
  }

  // ── Reads ────────────────────────────────────────────────────────────────────────────────

  private onShellRead(request: ReadRequest | null): void {
    if (request === null) {
      // Answered, or the command was interrupted while it waited.
      if (this.read !== null && this.read.id !== OWN_READ) this.endRead();
      return;
    }
    if (this.read?.id === request.id) return;
    this.beginRead(
      { id: request.id, prompt: request.prompt, secret: request.secret, hint: request.hint, oneKey: false, keepLine: false },
      (text) => this.shell.answerRead(request.id, text),
    );
  }

  private beginRead(read: PromptRead, answer: (text: string | null) => void): void {
    if (this.read !== null) this.finishRead(null);
    this.search = null;
    if (!read.keepLine) this.resetTab();
    // What was typed ahead waits, and comes back when the command has its answer; never across a
    // password prompt, where what was typed ahead may be the password (readpassphrase flushes it
    // too), and the input it was typed into goes when the read ends.
    const stash = read.keepLine || read.secret ? null : this.state;
    if (read.secret) {
      this.secret = '';
      this.secretExposed = this.text !== '';
    }
    this.read = { ...read, answer, stash, asked: read.oneKey ? this.state : null };
    if (!read.keepLine) this.write(EMPTY_LINE, { replace: true, force: true });
  }

  /** Ends the read on the prompt without answering it: the command answered or was stopped. */
  private endRead(): void {
    const read = this.read;
    if (read === null) return;
    this.read = null;
    if (read.secret) this.endSecret();
    if (!read.keepLine) this.write(read.stash ?? EMPTY_LINE, { replace: true, force: true });
  }

  /** Answers the read on the prompt: what was typed, or null for ^D and ^C. */
  private finishRead(text: string | null): void {
    const read = this.read;
    if (read === null) return;
    this.endRead();
    read.answer(text);
  }

  /**
   * A key while `Display all N possibilities? (y or n)` waits, as readline asks it: y, a space or
   * Tab lists them; n, Backspace, Escape, Enter, ^C or ^G does not. Any other key rings the bell
   * and the question stays.
   */
  private answerQuestion(key: string, chord = key): void {
    if (key === 'y' || key === 'Y' || key === ' ' || key === 'Tab') {
      this.finishRead('y');
      return;
    }
    if (key === 'n' || key === 'N' || key === 'Backspace' || key === 'Escape' || key === 'Enter' || chord === 'C-c' || chord === 'C-g') {
      this.finishRead('n');
      return;
    }
    this.ringBell();
  }

  // ── Running ──────────────────────────────────────────────────────────────────────────────

  /**
   * Enter, or a tapped line. Typed: answers a read, runs the search's line, or runs the line; an
   * unfinished line (an open quote, a trailing |) goes on at the `> ` prompt. While a command
   * runs, Enter only rings the bell and the line stays as type-ahead. A `line` is run as if
   * typed, interrupting anything running.
   */
  submit(line?: string, origin: JobOrigin = 'keyboard'): void {
    if (line !== undefined) {
      this.startLine(line, origin);
      return;
    }
    const read = this.read;
    if (read !== null) {
      if (!read.oneKey) this.finishRead(read.secret ? this.secret : this.text);
      return;
    }
    if (this.search !== null) {
      this.searchAccept();
      return;
    }
    if (this.running !== null) {
      this.ringBell();
      return;
    }
    const typed = this.text;
    const ps2 = this.ps2;
    if (ps2 === null && typed.trim() === '') {
      // A fresh prompt under the old one, as a terminal gives.
      this.screen.push({ prompt: this.shell.renderPrompt(), line: '', blocks: [] });
      this.write({ text: '', cursor: 0 }, { replace: true });
      return;
    }
    const joined = ps2 === null ? typed : joinContinuation(ps2.text, typed, ps2.reason);
    const reason = this.shell.incomplete(joined);
    if (reason !== null) {
      this.ps2 = { text: joined, reason, lines: [...(ps2?.lines ?? []), typed], prompt: ps2?.prompt ?? this.shell.renderPrompt() };
      this.recalled = null;
      this.resetTab();
      this.write({ text: '', cursor: 0 }, { replace: true });
      return;
    }
    this.startLine(joined, origin);
  }

  private startLine(line: string, origin: JobOrigin, options: StartOptions = {}): void {
    this.resetTab();
    this.search = null;
    this.ring = settleRing(this.ring);
    const prompt = this.ps2?.prompt ?? this.shell.renderPrompt();
    this.ps2 = null;
    this.recalled = null;
    this.historyDraft = null;
    // Committed at once: the line leaves the input, and its entry goes on the screen.
    this.write(EMPTY_LINE, { replace: true, force: true });
    this.running = { line, prompt };
    // The transcript follows this line's output, whatever started it: a key, a chip, a link.
    this.input?.dispatchEvent(new CustomEvent(SUBMIT_EVENT, { bubbles: true }));
    // Inside the key press or tap: a command that opens a URL opens it now, while it may.
    const preflight = this.shell.preflight(line);
    const run = ++this.runs;
    const handle = this.shell.start(line, origin, options);
    const settle = (): void => {
      if (run === this.runs && this.job === null) this.running = null;
    };
    handle.done.then((result) => {
      // What comes next follows the newest line only.
      if (run === this.runs) this.last = { line, argv: preflight?.argv ?? null, status: result.status };
      settle();
    }, settle);
  }

  /**
   * ^C: with a command running or reading, interrupts it and gives the prompt back at once;
   * otherwise prints the line with ^C under a fresh prompt, as bash does, and keeps it out of
   * history.
   */
  interrupt(): void {
    this.resetTab();
    if (this.read?.id === OWN_READ) {
      this.finishRead(null);
      return;
    }
    const search = this.search;
    if (search !== null) {
      this.search = null;
      this.write(search.saved, { replace: true });
    }
    if (this.running !== null || this.read !== null) {
      this.shell.abort();
      this.running = null;
      return;
    }
    const typed = this.text;
    const ps2 = this.ps2;
    this.ps2 = null;
    this.recalled = null;
    this.historyDraft = null;
    const shown = ps2 === null ? typed : [...ps2.lines, typed].join('\n> ');
    this.screen.push({ prompt: ps2?.prompt ?? this.shell.renderPrompt(), line: `${shown}^C`, blocks: [], status: 130 });
    this.write({ text: '', cursor: 0 }, { replace: true });
  }

  /** Ctrl+D: no answer to a command's prompt; on an empty line, `exit`. */
  private eof(): void {
    if (this.read !== null) {
      this.finishRead(null);
      return;
    }
    if (this.running !== null) return;
    const ps2 = this.ps2;
    if (ps2 !== null) {
      // The shell says what was left open, as bash does at the end of input.
      this.startLine(ps2.text, 'keyboard');
      return;
    }
    // As bash prints exit at the end of input and never keeps it in history.
    this.startLine('exit', 'keyboard', { record: false });
  }

  /** Ctrl+L: the screen clears and the line stays; so does a line still running, and its output. */
  clearScreen(): void {
    this.screen.clear((entry) => entry.state === 'running');
  }

  // ── Feedback ─────────────────────────────────────────────────────────────────────────────

  /** The visual bell: the prompt's underline flashes; nothing beeps. */
  ringBell(): void {
    this.bell = true;
    clearTimeout(this.bellTimer);
    this.bellTimer = setTimeout(() => (this.bell = false), BELL_MS);
  }

  private say(text: string): void {
    this.announced += 1;
    this.announce = this.announced % 2 === 0 ? text : `${text} `;
  }
}
