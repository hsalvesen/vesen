// A hanging indent for rows that are a label and a description, so that when the description
// wraps on a phone its next rows start under the description rather than at column 0:
//
// - the label rows of --help panels: `  -a, --all  do not ignore entries…`, whose first span is
//   indented text padded on the right with at least two spaces, as optionLines and the Commands
//   rows in src/shell/help.ts write it;
// - list rows such as cathode ls writes: a marker and a name, then a span of padding (two spaces
//   or more, and nothing else), then the description.
//
// A label wider than MAX_HANG cells does not hang, so the description keeps room to wrap in.

import { textWidth, type Line } from '../output/model';

const LABEL = /^ +\S(?:.*\S)? {2,}$/;
const PADDING = /^ {2,}$/;

/** The widest label a row hangs by, in cells. */
export const MAX_HANG = 24;

/** How many cells a row's wrapped rows hang by: its label's width, or 0. */
export function hangingIndent(line: Line): number {
  const [first, second] = line;
  if (first === undefined || second === undefined) return 0;
  if (LABEL.test(first.text)) return textWidth(first.text);
  // A label, then padding, then something after it.
  let label = '';
  for (let i = 0; i < line.length - 1; i += 1) {
    const text = (line[i] as Line[number]).text;
    if (i > 0 && PADDING.test(text) && label.trim() !== '' && line.slice(i + 1).some((span) => span.text.trim() !== '')) {
      const width = textWidth(label + text);
      return width <= MAX_HANG ? width : 0;
    }
    label += text;
  }
  return 0;
}
