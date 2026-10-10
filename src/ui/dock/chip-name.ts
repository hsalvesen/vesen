// What a dock chip says to a screen reader, and the glyph it shows. A chip's label is only the
// word it completes ('wombat'); its name says the whole of what a tap does ('Run: theme set
// wombat'), as designs/phone-and-instagram.md, "B. Exploring by tapping", asks.

import type { Chip } from '../../shell/complete/types';

/** The chip runs a line when tapped. */
export function runsLine(chip: Chip): boolean {
  return chip.line !== undefined && (chip.action.kind === 'run' || (chip.action.kind === 'apply' && chip.action.run === true));
}

/** The accessible name: what a tap does. */
export function chipName(chip: Chip): string {
  switch (chip.action.kind) {
    case 'interrupt':
      return 'Cancel the running command (Control C)';
    case 'cancel':
      return 'Cancel the password prompt';
    default:
      break;
  }
  if (runsLine(chip)) return `Run: ${chip.line ?? chip.label}`;
  if (chip.kind === 'didyoumean') return `Insert: ${chip.label} (did you mean ${chip.label}?)`;
  return `Insert: ${chip.label}`;
}

/** A glyph before the label, from the terminal's font: × to stop, ⏎ for the line itself. */
export function leadGlyph(chip: Chip): string | null {
  if (chip.action.kind === 'interrupt') return '×';
  if (chip.kind === 'current') return '⏎';
  return null;
}
