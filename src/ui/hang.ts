// A hanging indent for the label rows of --help panels: `  -a, --all  do not ignore entries…`.
// When the description wraps on a phone, its next rows start under the description rather than
// at column 0. A row is a label row when its first span is indented text padded on the right
// with at least two spaces, as optionLines and the Commands rows in src/shell/help.ts write it.

import { textWidth, type Line } from '../output/model';

const LABEL = /^ +\S(?:.*\S)? {2,}$/;

/** How many cells a panel row's wrapped rows hang by: its label's width, or 0. */
export function hangingIndent(line: Line): number {
  const [first, second] = line;
  if (first === undefined || second === undefined || !LABEL.test(first.text)) return 0;
  return textWidth(first.text);
}
