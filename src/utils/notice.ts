// Legacy HTML notices and errors, in the one callout style and the one error style of
// styles/components.css. The safe renderer's `panel` block replaces these as commands are ported.
import { escapeHtml } from '../output/escape';

/** A one-line notice in a warn-toned panel, the style used when something is cancelled. */
export function notice(message: string): string {
  return `<div class="out-panel tone-warn"><span class="out-strong">${escapeHtml(message)}</span></div>`;
}

const CANCELLED_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['weather', 'Weather request cancelled'],
  ['stock', 'Stock request cancelled'],
]);

/** What an interrupted command prints: its own wording where it has one. */
export function cancelledNotice(command: string): string {
  return notice(CANCELLED_MESSAGES.get(command) ?? `${command} cancelled`);
}

/**
 * An error: `cmd: message` in the error colour, then optionally a dim hint on the next line.
 * Both are plain text and are escaped here.
 */
export function errorLine(message: string, hint?: string): string {
  const error = `<span class="out-error">${escapeHtml(message)}</span>`;
  return hint === undefined ? error : `${error}\n<span class="out-muted">${escapeHtml(hint)}</span>`;
}
