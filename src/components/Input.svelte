<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { history, commandHistory, speedtestPhase } from "../stores/history";
  import { commands, processCommand } from "../utils/commands";
  import { virtualFileSystem, currentPath } from "../utils/virtualFileSystem";
  import themes from "../../themes.json";
  import { cathodeModes, crtQualities } from "../stores/cathode";
  import { interruptJob, runJob } from "../stores/job";
  import { escapeHtml } from "../output/escape";
  import { cancelledNotice, notice } from "../utils/notice";

  let {
    isPasswordMode = $bindable(),
    isProcessing = $bindable(false),
    loadingText = $bindable(""),
    command = $bindable(""),
  } = $props();

  let historyIndex = $state(-1);
  let input: HTMLInputElement;
  let pendingSudoCommand = $state("");
  let passwordInput = $state("");

  // The line that is running. It leaves the input on Enter, so the input collects type-ahead.
  let runningLine = $state("");
  let runningName = $state("");

  // Loading animation frames
  const loadingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  // Helper function to resolve file paths for completion
  const getCompletions = (
    input: string,
    isFilePath: boolean = false,
  ): string[] => {
    if (!isFilePath) {
      // Command completion
      return Object.keys(commands).filter((cmd) => cmd.startsWith(input));
    }

    // File path completion using actual virtual file system
    let searchPath = [...currentPath];
    let searchTerm = input;

    // Handle absolute paths
    if (input.startsWith("/")) {
      searchPath = [];
      searchTerm = input.substring(1);
    }

    // Handle relative paths with directories
    if (input.includes("/")) {
      const parts = input.split("/");
      searchTerm = parts.pop() || "";
      const pathParts = parts.filter((p) => p !== "");

      if (input.startsWith("/")) {
        searchPath = pathParts;
      } else {
        searchPath = [...currentPath, ...pathParts];
      }
    }

    // Navigate to the search directory
    let current = virtualFileSystem;
    for (const segment of searchPath) {
      if (current && current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        return [];
      }
    }

    // Get completions from current directory
    if (current && current.children) {
      return Object.keys(current.children)
        .filter((name) => name.startsWith(searchTerm))
        .map((name) => {
          const child = current.children![name];
          const fullPath =
            input.substring(0, input.lastIndexOf("/") + 1) + name;
          // Add trailing slash for directories
          if (child && child.type === "directory") {
            return fullPath + "/";
          }
          return fullPath;
        });
    }

    return [];
  };

  // Interrupt helper for sudo password prompt
  function interruptSudoPasswordPrompt() {
    isPasswordMode = false;
    pendingSudoCommand = "";
    passwordInput = "";

    // Append interrupt message to the last history entry using a highlighted block
    history.update((h) => {
      if (h.length === 0) return h;
      const last = { ...h[h.length - 1] };
      const outputs = [...last.outputs, notice("sudo: password entry cancelled")];
      const newLast = { ...last, outputs };
      return [...h.slice(0, -1), newLast];
    });

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
    if (isPasswordMode) {
      interruptSudoPasswordPrompt();
    } else if (isProcessing) {
      // runLine sees the interrupt at once and prints the cancelled notice.
      interruptJob();
    } else {
      // Like bash: echo the abandoned line with ^C under a fresh prompt. It is not kept in history.
      $history = [...$history, { command: `${command}^C`, outputs: [] }];
      command = "";
      historyIndex = -1;
    }
  }

  /**
   * Runs one line as the current job and records it once it finishes or is interrupted.
   * The input is never disabled, so it keeps focus through the run and nothing gives focus back
   * afterwards: it can only have left because the visitor put the keyboard away to read, and a
   * phone's keyboard stays as the visitor left it.
   */
  async function runLine(line: string, commandName: string, args: string[]) {
    command = "";
    historyIndex = -1;
    runningLine = line;
    runningName = commandName;
    isProcessing = true;

    let output: string;
    let interrupted = false;
    try {
      const outcome = await runJob(commandName, (signal) => processCommand(line, signal));
      interrupted = outcome.status === "interrupted";
      output = outcome.status === "done" ? outcome.value : cancelledNotice(commandName);
    } catch (error) {
      output = `Error: ${escapeHtml(String(error))}`;
    } finally {
      runningLine = "";
      runningName = "";
      isProcessing = false;
    }

    // Arrow-key history keeps everything except reset, which clears it.
    if (commandName !== "reset") {
      $commandHistory = [...$commandHistory, line];
    }

    // clear and reset leave the screen to themselves unless they were asked for help.
    const hasHelpFlag = args.includes("--help") || args.includes("-h");
    const skipsDisplay = (commandName === "clear" || commandName === "reset") && !hasHelpFlag;
    if (interrupted || !skipsDisplay) {
      $history = [...$history, { command: line, outputs: [output] }];
    }
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
      $history = [];
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

    if (event.key === "Enter") {
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
        // Just add an empty entry to history to show a new prompt line
        $history = [...$history, { command: "", outputs: [""] }];
        command = "";
        return;
      }

      const [commandName, ...args] = command.split(" ");

      // Special handling for sudo
      if (commandName === "sudo" && args.length > 0) {
        const hasHelpFlag = args.includes("--help") || args.includes("-h");
        // Check if help flag is present
        if (!hasHelpFlag) {
          pendingSudoCommand = args.join(" ");
          isPasswordMode = true;
          $history = [
            ...$history,
            {
              command,
              outputs: [],
            },
          ];
          command = "";
          return;
        }
      }

      await runLine(command, commandName, args);
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
        command = $commandHistory[$commandHistory.length - 1 - historyIndex];
      }
      event.preventDefault();
    } else if (event.key === "ArrowDown") {
      if (historyIndex > -1) {
        historyIndex--;
        command =
          historyIndex >= 0
            ? $commandHistory[$commandHistory.length - 1 - historyIndex]
            : "";
      }
      event.preventDefault();
    } else if (event.key === "Tab") {
      event.preventDefault();

      const parts = command.split(" ");
      const commandName = parts[0];
      const currentArg = parts[parts.length - 1] || "";

      // Commands that expect file paths as arguments
      const fileCommands = ["cd", "cat", "rm", "touch", "nano"];

      if (parts.length === 1) {
        // Complete command name
        const completions = getCompletions(commandName, false);
        if (completions.length === 1) {
          command = completions[0];
        } else if (completions.length > 1) {
          // Find common prefix
          const commonPrefix = completions.reduce((prefix, cmd) => {
            let i = 0;
            while (
              i < prefix.length &&
              i < cmd.length &&
              prefix[i] === cmd[i]
            ) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > commandName.length) {
            command = commonPrefix;
          }
        }
      } else if (commandName === "theme" && parts.length === 2) {
        // Complete theme subcommands (ls, set)
        const themeSubcommands = ["ls", "set"];
        const matchingSubcommands = themeSubcommands.filter((sub) =>
          sub.startsWith(currentArg.toLowerCase()),
        );

        if (matchingSubcommands.length === 1) {
          command = `theme ${matchingSubcommands[0]}`;
        } else if (matchingSubcommands.length > 1) {
          // Find common prefix
          const commonPrefix = matchingSubcommands.reduce((prefix, sub) => {
            let i = 0;
            while (
              i < prefix.length &&
              i < sub.length &&
              prefix[i] === sub[i]
            ) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            command = `theme ${commonPrefix}`;
          }
        }
      } else if (
        commandName === "theme" &&
        parts.length === 3 &&
        parts[1] === "set"
      ) {
        // Complete theme names for 'theme set' command
        const themeNames = themes.map((t) => t.name.toLowerCase());
        const matchingThemes = themeNames.filter((name) =>
          name.startsWith(currentArg.toLowerCase()),
        );

        if (matchingThemes.length === 1) {
          // Find the original case theme name
          const originalTheme = themes.find(
            (t) => t.name.toLowerCase() === matchingThemes[0],
          );
          if (originalTheme) {
            parts[parts.length - 1] = originalTheme.name;
            command = parts.join(" ");
          }
        } else if (matchingThemes.length > 1) {
          // Find common prefix
          const commonPrefix = matchingThemes.reduce((prefix, name) => {
            let i = 0;
            while (
              i < prefix.length &&
              i < name.length &&
              prefix[i] === name[i]
            ) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            parts[parts.length - 1] = commonPrefix;
            command = parts.join(" ");
          }
        }
      } else if (commandName === "cathode" && parts.length === 2) {
        // Complete cathode subcommands (ls, set, off, quality)
        const cathodeSubcommands = ["ls", "set", "off", "quality"];
        const matchingSubcommands = cathodeSubcommands.filter((sub) =>
          sub.startsWith(currentArg.toLowerCase()),
        );

        if (matchingSubcommands.length === 1) {
          command = `cathode ${matchingSubcommands[0]}`;
        } else if (matchingSubcommands.length > 1) {
          const commonPrefix = matchingSubcommands.reduce((prefix, sub) => {
            let i = 0;
            while (
              i < prefix.length &&
              i < sub.length &&
              prefix[i] === sub[i]
            ) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            command = `cathode ${commonPrefix}`;
          }
        }
      } else if (
        commandName === "cathode" &&
        parts.length === 3 &&
        parts[1] === "quality"
      ) {
        // Complete the quality, which has no shared prefixes to extend.
        const matching = crtQualities.filter((quality) =>
          quality.startsWith(currentArg.toLowerCase()),
        );
        if (matching.length === 1) {
          parts[parts.length - 1] = matching[0];
          command = parts.join(" ");
        }
      } else if (
        commandName === "cathode" &&
        parts.length === 3 &&
        parts[1] === "set"
      ) {
        // Complete cathode variation names for 'cathode set'
        const variations: string[] = cathodeModes.filter(
          (mode) => mode !== "off",
        );
        const matchingVariations = variations.filter((name) =>
          name.startsWith(currentArg.toLowerCase()),
        );

        if (matchingVariations.length === 1) {
          parts[parts.length - 1] = matchingVariations[0];
          command = parts.join(" ");
        } else if (matchingVariations.length > 1) {
          const commonPrefix = matchingVariations.reduce((prefix, name) => {
            let i = 0;
            while (
              i < prefix.length &&
              i < name.length &&
              prefix[i] === name[i]
            ) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            parts[parts.length - 1] = commonPrefix;
            command = parts.join(" ");
          }
        }
      } else if (commandName === "curl" && parts.length >= 2) {
        // Complete curl URL argument
        const curlSuggestions = [
          "curl explainshell.com",
          "curl https://httpbin.org/get",
        ];
        const matchingCurl = curlSuggestions.filter((s) =>
          s.startsWith(command.toLowerCase()),
        );
        const matchingCurlUrls = matchingCurl.map((s) =>
          s.slice("curl ".length),
        );

        if (matchingCurlUrls.length === 1) {
          command = `curl ${matchingCurlUrls[0]}`;
        } else if (matchingCurlUrls.length > 1) {
          const commonPrefix = matchingCurlUrls.reduce((prefix, url) => {
            let i = 0;
            while (i < prefix.length && i < url.length && prefix[i] === url[i])
              i++;
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            command = `curl ${commonPrefix}`;
          }
        }
      } else if (commandName === "qr" && parts.length >= 2) {
        // Complete qr URL argument
        const qrSuggestions = [
          "qr https://tldr.sh",
          "qr explainshell.com",
          "qr www.wikipedia.org/wiki/Computer_terminal",
          "qr https://shellcheck.net",
          "qr commandlinefu.com",
        ];
        const matchingFull = qrSuggestions.filter((s) =>
          s.startsWith(command.toLowerCase()),
        );
        // Work only with the URL portion (after 'qr ')
        const matchingUrls = matchingFull.map((s) => s.slice("qr ".length));

        if (matchingUrls.length === 1) {
          command = `qr ${matchingUrls[0]}`;
        } else if (matchingUrls.length > 1) {
          const commonPrefix = matchingUrls.reduce((prefix, url) => {
            let i = 0;
            while (i < prefix.length && i < url.length && prefix[i] === url[i])
              i++;
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            command = `qr ${commonPrefix}`;
          }
        }
      } else if (fileCommands.includes(commandName)) {
        // Complete file path
        const completions = getCompletions(currentArg, true);
        if (completions.length === 1) {
          parts[parts.length - 1] = completions[0];
          command = parts.join(" ");
        } else if (completions.length > 1) {
          // Find common prefix for file paths
          const commonPrefix = completions.reduce((prefix, path) => {
            let i = 0;
            while (
              i < prefix.length &&
              i < path.length &&
              prefix[i] === path[i]
            ) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            parts[parts.length - 1] = commonPrefix;
            command = parts.join(" ");
          }
        }
      }
    }
  };

  // The spinner under the prompt while a command runs; speedtest reports its phase.
  $effect(() => {
    if (!isProcessing) {
      loadingText = "";
      return;
    }

    let frame = 0;
    const render = () => {
      const phase = $speedtestPhase;
      const label = runningName === "speedtest" && phase ? phase : "Processing…";
      loadingText = `${loadingFrames[frame]} ${label}`;
    };
    untrack(render);
    const timer = setInterval(() => {
      frame = (frame + 1) % loadingFrames.length;
      render();
    }, 100);

    return () => clearInterval(timer);
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="prompt-line">
  {#if isProcessing && runningLine}
    <span class="running-line">{runningLine}</span>
  {/if}
  <span class="input-box">
    <input
      bind:this={input}
      bind:value={command}
      class="bg-transparent outline-none command-input"
      type={isPasswordMode ? "password" : "text"}
      aria-label="Terminal command"
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
