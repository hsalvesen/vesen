import { systemCommands } from './commands/system';
import { fileSystemCommands } from './commands/fileSystem';
import type { networkCommands as NetworkCommands } from './commands/network';
import { commandHelp } from './helpTexts';
import { playBeep } from './beep';
import { errorLine } from './notice';

const projectCommands = {
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
    async (args: string[], signal?: AbortSignal, status?: (text: string | null) => void): Promise<string> => {
      // Undefined when platform/chunkReload has taken the failure over to reload the page.
      const module = await loadNetworkCommands().catch(() => undefined);
      if (!module) {
        playBeep();
        return errorLine(`${name}: could not load the command. Check the connection and try again.`);
      }
      return module.networkCommands[name](args, signal, status);
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

// Combine all commands
export const commands: Record<string, (args: string[], signal?: AbortSignal, status?: (text: string | null) => void) => Promise<string> | string> = {
  ...systemCommands,
  ...fileSystemCommands,
  ...networkCommands,
  ...projectCommands,
  ...qrCommands
};
