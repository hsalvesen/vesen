// Legacy HTML notices. The safe renderer's `panel` block replaces these in Phase 1.
import { escapeHtml } from '../output/escape';

/** A one-line notice with a yellow border, the style used when something is cancelled. */
export function notice(message: string): string {
  return `<div style="position: relative; border-left: 4px solid var(--theme-yellow); padding: 8px 10px; border-radius: 4px; margin: 6px 0; margin-bottom: 20px;"><div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div><div style="position: relative;"><span style="color: var(--theme-white);">${escapeHtml(message)}</span></div></div>`;
}

const CANCELLED_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['weather', 'Weather request cancelled'],
  ['curl', 'Request cancelled'],
  ['stock', 'Stock request cancelled'],
  ['speedtest', 'Speed test cancelled'],
  ['fastfetch', 'Fastfetch request cancelled'],
]);

/** What an interrupted command prints: its own wording where it has one. */
export function cancelledNotice(command: string): string {
  return notice(CANCELLED_MESSAGES.get(command) ?? `${command} cancelled`);
}

/** A red one-line error. The message is plain text and is escaped here. */
export function errorLine(message: string): string {
  return `<span style="color: var(--theme-red);">${escapeHtml(message)}</span>`;
}
