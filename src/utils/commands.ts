import themes from '../../themes.json';
import { commandHistory } from './legacyStores';
import { systemCommands } from './commands/system';
import { fileSystemCommands } from './commands/fileSystem';
import type { networkCommands as NetworkCommands } from './commands/network';
import { theme } from '../stores/theme';
import {
  cathode,
  cathodeModes,
  cathodeModeInfo,
  cathodeQuality,
  crtQualities,
  crtTier,
  isCrtQuality,
  type CathodeMode,
} from '../stores/cathode';
import { get } from 'svelte/store';
import { commandHelp } from './helpTexts';
import { playBeep } from './beep';
import { errorLine } from './notice';
import { escapeHtml } from '../output/escape';
import { transcriptColumns } from '../platform/measure';

// Terminal-specific commands that don't fit in other modules
const terminalCommands = {
  help: (args: string[] = []) => {
    const commandList = commandNames();
    const target = args[0];

    if (target && commandList.includes(target)) {
      return getCommandHelp(target);
    }

    const terminalWidth = transcriptColumns(window);
    const minWidth = 30;
    const maxWidth = 120;
    const responsiveWidth = Math.min(maxWidth, Math.max(minWidth, terminalWidth));

    const maxCommandLength = commandList.reduce((max, cmd) => Math.max(max, cmd.length), 0);
    const colWidth = Math.max(8, maxCommandLength + 4);
    const cols = Math.max(1, Math.floor(responsiveWidth / colWidth));

    const lines: string[] = [];
    for (let i = 0; i < commandList.length; i += cols) {
      const row = commandList
        .slice(i, i + cols)
        .map((cmd) => cmd.padEnd(colWidth, ' '))
        .join('')
        .trimEnd();
      lines.push(row);
    }

    // Should the font be wider than measured, the grid scrolls rather than being cut off.
    return `<div style="white-space: pre; overflow-x: auto;">${lines.join('\n')}</div>`;
  },

  history: (args: string[]) => {
    const commandHistoryData: string[] = get(commandHistory);

    if (commandHistoryData.length === 0) {
      return 'No commands in history.';
    }

    // Calculate responsive width for history display
    const terminalWidth = transcriptColumns(window);
    const minWidth = 30; // Minimum width for history
    const maxWidth = 100; // Maximum width for history
    const responsiveWidth = Math.min(maxWidth, Math.max(minWidth, terminalWidth));

    // Format history with line numbers and handle overflow
    const historyLines: string[] = [];

    commandHistoryData.forEach((cmd: string, index: number) => {
      const lineNumber = (index + 1).toString().padStart(4, ' ');
      // Numbers in the accent role, commands in strong text.
      const prefix = `<span class="out-accent">${lineNumber}</span>  `;

      // Check if the line is too long and needs wrapping
      const totalLength = lineNumber.length + 2 + cmd.length; // +2 for spacing

      if (totalLength > responsiveWidth) {
        // Split long commands across multiple lines
        const commandMaxWidth = responsiveWidth - 6; // Account for line number and spacing
        const chunks: string[] = [];

        for (let i = 0; i < cmd.length; i += commandMaxWidth) {
          chunks.push(cmd.substring(i, i + commandMaxWidth));
        }

        // First line with line number. Chunks are cut from the typed text, then escaped.
        historyLines.push(prefix + `<span class="out-strong">${escapeHtml(chunks[0])}</span>`);

        // Continuation lines with proper indentation
        for (let i = 1; i < chunks.length; i++) {
          const indent = '      '; // 6 spaces to align with command text
          historyLines.push(`${indent}<span class="out-strong">${escapeHtml(chunks[i])}</span>`);
        }
      } else {
        // Command fits on one line
        historyLines.push(prefix + `<span class="out-strong">${escapeHtml(cmd)}</span>`);
      }
    });

    return historyLines.join('\n');
  },

  sudo: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.sudo;
    }

    // This shouldn't be reached in normal flow since Input.svelte handles sudo specially
    // But keeping as fallback
    window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank');
    return '';
  },

};

/** The palette slots `theme ls` previews, in terminal order, each as a two-cell swatch. */
const SWATCH_SLOTS = ['foreground', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'brightBlack'] as const;

// Project-specific commands
const projectCommands = {
  theme: (args: string[]) => {
    const usage = `<span style="color: var(--theme-cyan); font-weight: bold;">theme</span> - Change terminal theme
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> theme <span style="color: var(--theme-green);">[args]</span>.
  <span style="color: var(--theme-green);">args:</span>
    ls: list all available themes
    set: set theme to [theme]

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  theme ls
  theme set swamphen`;
    if (args.length === 0) {
      return renderHelp(usage);
    }

    switch (args[0]) {
      case 'ls': {
        // One row per theme: its name, then swatches drawn in its own colours on its own
        // background (hex on purpose: each row previews that theme, whatever theme is showing).
        // The stylesheet marks the current theme, and legacy-highlights moves the mark later.
        const current = get(theme).name.toLowerCase();
        const width = Math.max(...themes.map((t) => t.name.length));
        const rows = themes.map((t) => {
          const name = t.name.toLowerCase();
          const label = `<span class="theme-name${name === current ? ' is-current' : ''}" data-theme-name="${name}">${escapeHtml(t.name)}</span>`;
          const swatches = SWATCH_SLOTS.map((slot) => `<span style="color: ${t[slot]};">██</span>`).join('');
          const preview = `<span class="swatches" aria-hidden="true" style="background-color: ${t.background};"> ${swatches} </span>`;
          return `${label}${' '.repeat(width - t.name.length + 2)}${preview}`;
        });
        return `${rows.join('\n')}\n\n<span class="out-muted">Try one with: theme set [name]</span>`;
      }

      case 'set': {
        if (args.length !== 2) {
          return renderHelp(usage);
        }

        const selectedTheme = args[1];
        const t = themes.find((t) => t.name.toLowerCase() === selectedTheme.toLowerCase());

        if (!t) {
          playBeep();
          return errorLine(`theme: ${selectedTheme}: no such theme`, "Try 'theme ls' to see all available themes.");
        }

        theme.set(t);

        return `Theme set to ${t.name}`;
      }

      default: {
        return renderHelp(usage);
      }
    }
  },
  cathode: (args: string[]) => {
    const usage = `<span style="color: var(--theme-cyan); font-weight: bold;">cathode</span> - Trial a retro CRT (cathode ray tube) display effect
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> cathode <span style="color: var(--theme-green);">[args]</span>.
  <span style="color: var(--theme-green);">args:</span>
    ls: list all cathode variations and the quality in use
    set: set the effect to [variation]
    off: turn the effect off
    quality: auto, full, lite or off (auto suits the device)

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  cathode ls
  cathode set vintage
  cathode quality lite
  cathode off`;

    const applyMode = (mode: CathodeMode) => {
      cathode.set(mode);
      if (mode === 'off') {
        return 'Cathode effect turned off.';
      }
      return `Cathode effect set to ${mode}. Try 'cathode ls' to compare the variations.`;
    };

    /** The tier in force and why, such as "lite (auto: a touch screen)". */
    const describeQuality = () => {
      const { tier, reason, quality } = get(crtTier);
      return `${tier} (${quality === 'auto' ? `auto: ${reason}` : reason})`;
    };

    if (args.length === 0) {
      return renderHelp(usage);
    }

    switch (args[0]) {
      case 'ls': {
        const current = get(cathode);
        const nameWidth = Math.max(...cathodeModes.map((m) => m.length));

        const rows = cathodeModeInfo
          .map(({ name, summary }) => {
            const isCurrent = name === current;
            const padding = ' '.repeat(nameWidth - name.length + 2);
            const label = `<span class="cathode-name${isCurrent ? ' is-current' : ''}" data-cathode-name="${name}">${name}</span>`;
            return `${label}${padding}<span class="out-strong">${summary}</span>`;
          })
          .join('\n');

        return `<span class="out-accent">Cathode variations (current marked):</span>
${rows}

<span class="out-accent">Quality:</span> <span class="out-strong">${escapeHtml(describeQuality())}</span>

<span class="out-muted">Trial one with: cathode set [variation]</span>
<span class="out-muted">Change the quality with: cathode quality [auto|full|lite|off]</span>`;
      }

      case 'set': {
        if (args.length !== 2) {
          return renderHelp(usage);
        }

        const requested = args[1].toLowerCase();
        const match = cathodeModes.find((m) => m === requested);
        if (!match) {
          playBeep();
          return errorLine(`cathode: ${args[1]}: no such variation`, "Try 'cathode ls' to see all available variations.");
        }

        return applyMode(match);
      }

      case 'off': {
        return applyMode('off');
      }

      case 'quality': {
        if (args.length === 1) {
          return `Cathode quality: ${escapeHtml(describeQuality())}\n<span class="out-muted">Change it with: cathode quality [auto|full|lite|off]</span>`;
        }
        const requested = args[1].toLowerCase();
        if (args.length !== 2 || !isCrtQuality(requested)) {
          playBeep();
          return errorLine(`cathode: quality: ${args.slice(1).join(' ')}: not a quality`, `Choose one of: ${crtQualities.join(', ')}.`);
        }
        // bootstrap decides the tier again as soon as the quality changes.
        cathodeQuality.set(requested);
        return `Cathode quality set to ${requested}: ${escapeHtml(describeQuality())}.`;
      }

      default: {
        // Friendly shortcut: `cathode vintage` behaves like `cathode set vintage`.
        const requested = args[0].toLowerCase();
        const match = cathodeModes.find((m) => m === requested);
        if (match) {
          return applyMode(match);
        }
        return renderHelp(usage);
      }
    }
  },
  // The shell opens the repository (spec.opens, inside the Enter gesture); this is what it prints.
  repo: () => `<span class="out-accent">Opening Vesen repository...</span>`,

  // The shell opens emailHref() (spec.opens, inside the Enter gesture); this is what it prints.
  email: () => 'Opening email client...',
};

/** The developer's address, with the time in the subject so threads stay apart. */
export function emailHref(now: Date = new Date()): string {
  const timestamp = now.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return `mailto:has@salvesen.app?subject=${encodeURIComponent(`Terminal Contact - ${timestamp}`)}`;
}

// Re-export virtualFileSystem and currentPath from the dedicated module
export { virtualFileSystem, currentPath } from './virtualFileSystem';

// Detailed help for a command, from its legacy help text.
function getCommandHelp(command: string): string {
  return legacyHelpHtml(command) ?? errorLine(`help: no help available for ${command}`);
}

/** A legacy command's help laid out as panels, as `<cmd> --help` shows it; undefined when it has none. */
export function legacyHelpHtml(command: string): string | undefined {
  const raw = Object.prototype.hasOwnProperty.call(commandHelp, command) ? commandHelp[command] : undefined;
  return raw ? renderHelp(raw) : undefined;
}

/**
 * Lays legacy help or usage text out as panels in the one callout style (styles/components.css):
 * what the command does in the accent tone, its usage in the link tone, and its examples and tips
 * in the warn tone. Body text is strong text; each panel's title takes its tone.
 */
function renderHelp(raw: string): string {
  // Normalize and split into lines
  const normalized = raw.replace(/\n/g, '<br>');
  const lines = normalized.split('<br>');

  // Locate section indices
  const usageIdx = lines.findIndex(l => /Usage:/i.test(l));
  const examplesIdx = lines.findIndex(l => /Examples:/i.test(l));
  const tipIdx = lines.findIndex(l => /Tip:/i.test(l));

  // What it does: everything before Usage:
  const explanationLines =
    usageIdx > 0 ? lines.slice(0, usageIdx) : (usageIdx === 0 ? [] : lines);

  // Usage: from Usage: to just before Examples: or Tip:
  const usageEnd = Math.min(
    examplesIdx >= 0 ? examplesIdx : lines.length,
    tipIdx >= 0 ? tipIdx : lines.length
  );
  const usageLines =
    usageIdx >= 0 ? lines.slice(usageIdx, usageEnd) : [];

  // Examples and tips: from Examples: or Tip: onward
  const examplesLines =
    examplesIdx >= 0
      ? lines.slice(examplesIdx + 1, tipIdx >= 0 ? tipIdx : lines.length)
      : [];
  const tipsLines =
    tipIdx >= 0 ? lines.slice(tipIdx + 1) : [];

  // Helpers to strip label text from first line when needed
  const stripLabel = (line: string, label: 'Usage' | 'Examples' | 'Tip') =>
    line
      .replace(new RegExp(`<span[^>]*>${label}:<\\/span>\\s*`, 'i'), '')
      .replace(new RegExp(`${label}:\\s*`, 'i'), '');

  // Build usage content: remove the leading "Usage:" label and keep the rest
  let usageContent = '';
  if (usageLines.length) {
    const first = stripLabel(usageLines[0], 'Usage');
    const rest = usageLines.slice(1).join('<br>');
    usageContent = [first, rest].filter(Boolean).join('<br>');
  }

  const title = (text: string) => `<div class="out-panel-title">${text}</div>`;
  const body = (html: string) => `<div class="out-strong">${html}</div>`;

  let output = '';
  if (explanationLines.length) {
    output += `<div class="out-panel">${body(explanationLines.join('<br>'))}</div>`;
  }
  if (usageContent) {
    output += `<div class="out-panel tone-link">${title('Usage:')}${body(usageContent)}</div>`;
  }
  if (examplesIdx >= 0 || tipIdx >= 0) {
    output += `<div class="out-panel tone-warn">`;
    if (examplesIdx >= 0) output += `${title('Examples:')}${body(examplesLines.join('<br>'))}`;
    if (tipIdx >= 0) output += `${title('Tip:')}${body(tipsLines.join('<br>'))}`;
    output += `</div>`;
  }
  return output;
}

// The network commands load the first time one of them runs, which keeps them out of the
// initial chunk. Their names are known up front, so help and completion list them before then.
type NetworkCommand = keyof typeof NetworkCommands;
export const NETWORK_COMMAND_NAMES: readonly NetworkCommand[] = ['weather', 'curl', 'stock', 'speedtest'];

let networkModule: Promise<typeof import('./commands/network')> | undefined;

function loadNetworkCommands(): Promise<typeof import('./commands/network')> {
  if (networkModule === undefined) {
    const loading = import('./commands/network');
    // A failed load (offline, say) is tried again the next time.
    loading.catch(() => {
      if (networkModule === loading) networkModule = undefined;
    });
    networkModule = loading;
  }
  return networkModule;
}

const networkCommands = Object.fromEntries(
  NETWORK_COMMAND_NAMES.map((name) => [
    name,
    async (args: string[], signal?: AbortSignal): Promise<string> => {
      // Undefined when platform/chunkReload has taken the failure over to reload the page.
      const module = await loadNetworkCommands().catch(() => undefined);
      if (!module) {
        playBeep();
        return errorLine(`${name}: could not load the command. Check the connection and try again.`);
      }
      return module.networkCommands[name](args, signal);
    },
  ]),
);

// qr loads the first time it runs, with its encoder, which keeps both out of the initial chunk.
const qrCommands = {
  qr: async (args: string[]): Promise<string> => {
    // Undefined when platform/chunkReload has taken the failure over to reload the page.
    const module = await import('./commands/qr').catch(() => undefined);
    if (!module) {
      playBeep();
      return errorLine('qr: could not load the command. Check the connection and try again.');
    }
    return module.qrCommands.qr(args);
  },
};

/** Where the names of every command come from: the shell's registry, once it has loaded. */
let catalogue: () => readonly string[] = () => Object.keys(commands);

/**
 * Every command name, sorted: the legacy commands until the shell has loaded, then the
 * registry's, so commands ported to specs (cd, pwd, reset) stay in help and completion.
 */
export function commandNames(): string[] {
  return [...new Set(catalogue())].sort((a, b) => a.localeCompare(b));
}

/** Lists the registry's commands from now on (legacyShell.ts calls it once the shell is built). */
export function setCommandCatalogue(names: () => readonly string[]): void {
  catalogue = names;
}

// Combine all commands
export const commands: Record<string, (args: string[], signal?: AbortSignal) => Promise<string> | string> = {
  ...systemCommands,
  ...fileSystemCommands,
  ...networkCommands,
  ...terminalCommands,
  ...projectCommands,
  ...qrCommands
};
