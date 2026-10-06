<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { screen } from "../stores/screen";
  import { commandHistory, speedtestPhase } from "../utils/legacyStores";
  import { outputBlocks } from "../interfaces/command";
  import type { JobOrigin, ShellPort } from "../shell/index";
  import type { ExitCode, JobInfo } from "../shell/types";
  import {
    TAB_IDLE,
    type Chip,
    type Completion,
    type CompletionResult,
    type EditState,
    type TabEffect,
    type TabState,
  } from "../shell/complete/types";
  import { COMPLETION_LIST_ID, optionId } from "../ui/CompletionRow.svelte";
  import { notice } from "../utils/notice";

  /** What the completion row under the prompt shows. */
  export interface CompletionView {
    readonly chips: readonly Chip[];
    readonly more: number;
    readonly listed: boolean;
    readonly question: string | null;
    readonly announce: string;
  }

  let {
    shell,
    isPasswordMode = $bindable(),
    isProcessing = $bindable(false),
    loadingText = $bindable(""),
    command = $bindable(""),
    completionView = $bindable(),
  }: {
    /** Runs every line: parsing, pipes, redirection, history and ^C are the shell's. */
    shell: ShellPort;
    isPasswordMode?: boolean;
    isProcessing?: boolean;
    loadingText?: string;
    command?: string;
    /** The chips and list for the completion row, which App draws under the prompt. */
    completionView?: CompletionView;
  } = $props();

  let historyIndex = $state(-1);
  let input: HTMLInputElement;
  let pendingSudoCommand = $state("");
  let passwordInput = $state("");

  // The line that is running. It leaves the input on Enter, so the input collects type-ahead.
  let runningLine = $state("");
  // Which run is current, so a run that was replaced does not end the busy state of the next.
  let runs = 0;

  // The shell's job: the command now running, for the status line. The prompt is idle again the
  // moment the job ends, in the same update as its transcript entry, so the two never show apart.
  let job = $state<JobInfo | null>(null);
  $effect(() =>
    shell.job.subscribe((value) => {
      job = value;
      if (value === null && untrack(() => isProcessing)) {
        runningLine = "";
        isProcessing = false;
      }
    }),
  );

  // Loading animation frames
  const loadingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  // ── Completion: Tab, the chips and the list (src/shell/complete) ──────────────────────────

  /** The engine and this session's commands and files; null until its chunk has loaded. */
  let completion = $state<Completion | null>(null);
  $effect(() => shell.completion.subscribe((value) => (completion = value)));

  let lastStatus = $state<ExitCode>(0);
  $effect(() => shell.lastStatus.subscribe((value) => (lastStatus = value)));

  /** Where the caret is, kept in step with the input. */
  let cursor = $state(0);
  let tab = $state<TabState>(TAB_IDLE);
  /** For the polite live region; a no-break space alternates so a repeat is announced again. */
  let announce = $state("");
  let announced = 0;
  /** The visual bell: the prompt flashes, and nothing beeps. */
  let bell = $state(false);
  let bellTimer: ReturnType<typeof setTimeout> | undefined;

  const touch = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);

  const result = $derived<CompletionResult | null>(
    completion === null || isPasswordMode ? null : completion.engine.complete({ text: command, cursor: Math.min(cursor, command.length) }, completion.env),
  );

  const view = $derived.by((): CompletionView => {
    const engine = completion?.engine;
    if (engine === undefined || completion === null) return { chips: [], more: 0, listed: false, question: null, announce };
    const shown = engine.tabView(tab);
    const list = engine.chipsFor({
      mode: isPasswordMode ? "secret" : isProcessing ? "busy" : "edit",
      state: { text: command, cursor: Math.min(cursor, command.length) },
      result,
      tab,
      touch,
      registry: completion.env.registry,
      history: $commandHistory,
      max: touch ? 24 : 8,
      lastStatus,
    });
    // The status line under the prompt already stops a running command.
    const chips = list.chips.filter((chip) => chip.action.kind !== "interrupt");
    return { chips, more: list.more, listed: shown.result !== null, question: shown.question, announce };
  });
  $effect(() => {
    completionView = view;
  });

  /** The menu's choice, for aria-activedescendant. */
  const activeOption = $derived.by(() => {
    const index = view.chips.findIndex((chip) => chip.selected === true);
    return index === -1 ? undefined : optionId(index);
  });

  function say(text: string): void {
    announced += 1;
    announce = announced % 2 === 0 ? text : `${text}\u00a0`;
  }

  function ring(): void {
    bell = true;
    clearTimeout(bellTimer);
    bellTimer = setTimeout(() => (bell = false), 150);
  }

  /** Puts a line in the input, with the caret where the edit leaves it. */
  function setLine(state: EditState): void {
    command = state.text;
    cursor = state.cursor;
    if (input) {
      input.value = state.text;
      input.setSelectionRange(state.cursor, state.cursor);
    }
  }

  function applyEffect(effect: TabEffect): void {
    if (effect.edit) setLine(effect.edit);
    if (effect.bell) ring();
    if (effect.announce) say(effect.announce);
  }

  /** Tab, or Shift+Tab. */
  function pressTab(reverse: boolean): void {
    if (completion === null) return;
    const step = completion.engine.pressTab(tab, { text: command, cursor: input.selectionStart ?? command.length }, completion.env, reverse);
    tab = step.tab;
    applyEffect(step.effect);
  }

  /** Ends any Tab in progress, as an edit or a run does. */
  function resetTab(): void {
    tab = TAB_IDLE;
  }

  /**
   * A tapped or clicked chip: an edit goes on the line exactly as Tab would put it there, and
   * focus stays on the prompt, so a phone's keyboard stays up; a starter runs.
   */
  export function choose(chip: Chip): void {
    const action = chip.action;
    if (action.kind === "apply") {
      const edit = completion?.engine.applyChip(chip) ?? null;
      resetTab();
      if (edit !== null) setLine(edit);
      input?.focus({ preventScroll: true });
    } else if (action.kind === "run") {
      resetTab();
      void submit(action.line);
      focusPrompt();
    } else if (action.kind === "interrupt") {
      shell.abort();
    } else if (action.kind === "cancel") {
      interruptSudoPasswordPrompt();
    }
  }

  /** Keeps the caret position in step after the visitor types, clicks or selects. */
  function syncCursor(): void {
    cursor = input?.selectionStart ?? command.length;
  }

  function onInput(): void {
    syncCursor();
    // Any edit ends a Tab in progress.
    resetTab();
  }

  // Interrupt helper for sudo password prompt
  function interruptSudoPasswordPrompt() {
    isPasswordMode = false;
    pendingSudoCommand = "";
    passwordInput = "";

    // Append the interrupt notice to the sudo line's entry, in a highlighted block
    screen.appendToLast(outputBlocks(notice("sudo: password entry cancelled")));

    // Reset input state
    command = "";
    historyIndex = -1;

    input?.focus({ preventScroll: true });
  }

  /** True when text is selected in the page or in the prompt, so Ctrl+C should copy it. */
  function hasSelection(): boolean {
    if (window.getSelection()?.toString()) return true;
    return (
      document.activeElement === input &&
      input.selectionStart !== null &&
      input.selectionStart !== input.selectionEnd
    );
  }

  /** Ctrl+C: cancels the sudo prompt, interrupts the running command, or abandons the line. */
  function interrupt() {
    resetTab();
    if (isPasswordMode) {
      interruptSudoPasswordPrompt();
    } else if (isProcessing) {
      // The shell ends the job at once with ^C; runLine then records it.
      shell.abort();
    } else {
      // Like bash: echo the abandoned line with ^C under a fresh prompt. It is not kept in history.
      screen.push({ prompt: shell.renderPrompt(), line: `${command}^C`, blocks: [], status: 130 });
      setLine({ text: "", cursor: 0 });
      historyIndex = -1;
    }
  }

  /**
   * Runs one line through the shell, which records it in the transcript once it finishes or is
   * interrupted. The input is never disabled, so it keeps focus through the run and nothing gives
   * focus back afterwards: it can only have left because the visitor put the keyboard away to
   * read, and a phone's keyboard stays as the visitor left it.
   */
  async function runLine(line: string, origin: JobOrigin = "keyboard") {
    const run = ++runs;
    resetTab();
    setLine({ text: "", cursor: 0 });
    historyIndex = -1;
    runningLine = line;
    isProcessing = true;
    try {
      await shell.start(line, origin).done;
    } finally {
      if (run === runs) {
        runningLine = "";
        isProcessing = false;
      }
    }
  }

  /**
   * Runs a line from a tapped did-you-mean or chip, as if typed. The shell opens any URL the
   * command opens inside this tap, while the browser still allows it.
   */
  export function submit(line: string): Promise<void> {
    shell.preflight(line);
    return runLine(line, "chip");
  }

  /** Puts text at the prompt, for a tapped suggestion that inserts rather than runs. */
  export function insert(text: string): void {
    resetTab();
    setLine({ text, cursor: text.length });
    historyIndex = -1;
    // As if typed: the transcript brings the prompt back into view and stays with it while the
    // completions under it change (ui/actions/stickToBottom.ts).
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Focuses the prompt without scrolling, on a desktop; on touch it would open the keyboard, so
   * only with `keyboard`, for a tap that put text at the prompt to be finished. Call it inside the
   * tap, which is the only time iOS lets focus open the keyboard.
   */
  export function focusPrompt(options: { keyboard?: boolean } = {}): void {
    if (options.keyboard || !window.matchMedia?.("(pointer: coarse)").matches) input?.focus({ preventScroll: true });
  }

  // A keyboard and mouse can start typing at once. On touch, focus opens the soft keyboard over
  // the page, so the prompt waits for a tap (ui/actions/focusPolicy.ts).
  onMount(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) input.focus({ preventScroll: true });
  });

  // Escape at an idle prompt, then Tab or Shift+Tab within a second, moves focus out of the
  // terminal as usual, so the page has no keyboard trap.
  const ESCAPE_TAB_MS = 1000;
  let escapedAt = -Infinity;
  const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

  const handleKeyDown = async (event: KeyboardEvent) => {
    if (event.ctrlKey && event.key === "c") {
      // With text selected, let the browser copy it.
      if (hasSelection()) return;
      event.preventDefault();
      interrupt();
      return;
    }

    const listOpen = tab.phase === "listed" || tab.phase === "menu" || tab.phase === "asking";
    if (event.key === "Escape" && event.target === input && listOpen && completion !== null) {
      // Escape closes the list; in the menu it also puts back what was typed.
      event.preventDefault();
      const step = tab.phase === "menu" ? completion.engine.menuKey(tab, "escape") : { tab: TAB_IDLE, effect: {} };
      tab = step.tab;
      applyEffect(step.effect);
      return;
    }

    if (event.key === "Escape") {
      if (isProcessing || isPasswordMode) {
        event.preventDefault();
        interrupt();
      } else {
        escapedAt = performance.now();
      }
      return;
    }

    // Handle Ctrl+L globally
    if (event.ctrlKey && event.key === "l") {
      event.preventDefault();
      screen.clear();
      return;
    }

    // The rest edits the prompt. Keys meant for another control, such as Enter on the
    // new-output pill or the cancel button, are left to it.
    if (event.target !== input) return;

    const leaving = event.key === "Tab" && performance.now() - escapedAt <= ESCAPE_TAB_MS;
    if (!MODIFIER_KEYS.has(event.key)) escapedAt = -Infinity;
    if (leaving) return;

    // While a command runs, keys type ahead into the input. Enter waits for the prompt, and Tab
    // is held so focus stays in the input.
    if (isProcessing) {
      if (event.key === "Enter" || event.key === "Tab") event.preventDefault();
      return;
    }

    // `Display all N possibilities? (y or n)`: y or a space lists them; any other key does not,
    // and n says no without typing itself.
    if (tab.phase === "asking" && completion !== null && event.key !== "Tab" && !MODIFIER_KEYS.has(event.key)) {
      const yes = event.key === "y" || event.key === "Y" || event.key === " ";
      const step = completion.engine.answer(tab, yes);
      tab = step.tab;
      applyEffect(step.effect);
      if (yes || event.key === "n" || event.key === "N") {
        event.preventDefault();
        return;
      }
    }

    // In the Tab menu, Enter takes the choice without running it; any other key keeps the choice
    // on the line and goes on as usual.
    if (tab.phase === "menu" && completion !== null && event.key !== "Tab" && !MODIFIER_KEYS.has(event.key)) {
      const step = completion.engine.menuKey(tab, event.key === "Enter" ? "enter" : "commit");
      tab = step.tab;
      applyEffect(step.effect);
      if (event.key === "Enter") {
        event.preventDefault();
        return;
      }
    }

    if (event.key === "Enter") {
      resetTab();
      if (isPasswordMode) {
        isPasswordMode = false;
        passwordInput = "";

        window.open("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "_blank");
        pendingSudoCommand = "";
        command = "";
        return;
      }

      // Check if command is empty or only whitespace
      if (!command.trim()) {
        // Just add an empty entry to show a new prompt line
        screen.push({ prompt: shell.renderPrompt(), line: "", blocks: [] });
        command = "";
        return;
      }

      const line = command;
      // Synchronous, inside the key press: the shell reads the line, and opens any URL its
      // command opens while the browser still allows it.
      const preflight = shell.preflight(line);

      // sudo asks for a password first. The shell read the words, so quoting and leading spaces
      // make no difference.
      const [name, ...args] = preflight?.argv ?? [];
      const asksHelp = args[0] === "-h" || args.includes("--help");
      if (name === "sudo" && args.length > 0 && !asksHelp) {
        pendingSudoCommand = args.join(" ");
        isPasswordMode = true;
        shell.remember(line);
        screen.push({ prompt: shell.renderPrompt(), line, blocks: [] });
        command = "";
        return;
      }

      await runLine(line);
    } else if (isPasswordMode) {
      // Handle password input (hide characters)
      if (event.key === "Backspace") {
        passwordInput = passwordInput.slice(0, -1);
      } else if (event.key.length === 1) {
        passwordInput += event.key;
      }
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      if (historyIndex < $commandHistory.length - 1) {
        historyIndex++;
        const recalled = $commandHistory[$commandHistory.length - 1 - historyIndex] ?? "";
        resetTab();
        setLine({ text: recalled, cursor: recalled.length });
      }
      event.preventDefault();
    } else if (event.key === "ArrowDown") {
      if (historyIndex > -1) {
        historyIndex--;
        const recalled = historyIndex >= 0 ? ($commandHistory[$commandHistory.length - 1 - historyIndex] ?? "") : "";
        resetTab();
        setLine({ text: recalled, cursor: recalled.length });
      }
      event.preventDefault();
    } else if (event.key === "Tab") {
      // Complete: extend, then list, then a menu that Tab and Shift+Tab step through.
      event.preventDefault();
      pressTab(event.shiftKey);
    }
  };

  // The spinner under the prompt while a command runs: what the command is doing (its spec's
  // loading label; speedtest reports its phase), and how to stop it.
  let frame = $state(0);
  $effect(() => {
    if (!isProcessing) return;
    untrack(() => (frame = 0));
    const timer = setInterval(() => {
      frame = (frame + 1) % loadingFrames.length;
    }, 100);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (!isProcessing) {
      loadingText = "";
      return;
    }
    const phase = $speedtestPhase;
    const label = job?.name === "speedtest" && phase ? phase : (job?.label ?? "Processing…");
    loadingText = `${loadingFrames[frame]} ${label}`;
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="prompt-line">
  {#if isProcessing && runningLine}
    <span class="running-line">{runningLine}</span>
  {/if}
  <span class="input-box" class:bell data-completion={completion === null ? undefined : "ready"}>
    <input
      bind:this={input}
      bind:value={command}
      oninput={onInput}
      onkeyup={syncCursor}
      onclick={syncCursor}
      onselect={syncCursor}
      onfocus={syncCursor}
      class="bg-transparent outline-none command-input"
      type={isPasswordMode ? "password" : "text"}
      aria-label="Terminal command"
      aria-controls={view.chips.length > 0 ? COMPLETION_LIST_ID : undefined}
      aria-activedescendant={activeOption}
      enterkeyhint="go"
      autocomplete="off"
      spellcheck="false"
      autocapitalize="none"
      autocorrect="off"
      inputmode="text"
    />
  </span>
</div>

<style>
  /* The visual bell: nothing to complete. The underline flashes once; there is no beep. */
  .input-box {
    box-shadow: inset 0 -1px 0 transparent;
  }

  .input-box.bell {
    box-shadow: inset 0 -2px 0 var(--role-warn);
  }

  /* While a command runs, its line sits on the prompt row and the type-ahead input on the line
     below, so the input is never squeezed to nothing. */
  .prompt-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 1ch;
    min-width: 0;
  }

  .input-box {
    display: block;
    flex: 1 1 8ch;
    min-width: 8ch;
  }

  /* The caret takes the cursor role until the drawn block cursor replaces it. */
  .command-input {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    color: var(--role-fg-strong);
    caret-color: var(--role-cursor, currentColor);
  }

  /* A whole line to itself, so the input is the same width with or without it. WebKit scrolls
     a focused input back into view whenever its width changes, which would drag the transcript
     to the bottom when the command finishes, away from a visitor reading further up. */
  .running-line {
    flex-basis: 100%;
    color: var(--role-fg-strong);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    min-width: 0;
  }

  /* Touch: iOS zooms into any input under 16px when it takes focus. The input is really 16px and
     drawn at the terminal's size by --input-scale (platform/measure.ts); the box is one terminal
     line tall and clips the unscaled layout. At --input-scale: 1 this is a plain 16px input. */
  @media (pointer: coarse) {
    .input-box {
      height: calc(16px * var(--term-lh) * var(--input-scale));
      overflow: hidden;
    }

    .command-input {
      font-size: 16px;
      line-height: var(--term-lh);
      height: calc(16px * var(--term-lh));
      width: calc(100% / var(--input-scale));
      transform: scale(var(--input-scale));
      transform-origin: 0 0;
    }
  }
</style>
