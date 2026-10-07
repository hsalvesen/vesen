// The plain-text form of every block (docs/plan/02-architecture-and-contracts.md, section 2):
// what a pipe or a file receives instead of the rich block a terminal draws. Kept apart from the
// output model, which the first paint loads, because only the kernel's streams and the session
// restore need it, and with it the legacy HTML-to-text reading.

import { htmlToText } from './html-to-text';
import { lineText, textWidth, type Block, type TableBlock } from './model';

function terminated(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

function asLines(rows: readonly string[]): string {
  return rows.map((row) => `${row}\n`).join('');
}

function tableRows(table: TableBlock): string[] {
  const rows = (table.head ? [table.head, ...table.rows] : table.rows).map((row) => row.map(lineText));
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, textWidth(cell));
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => {
        const pad = ' '.repeat((widths[i] ?? 0) - textWidth(cell));
        return table.align?.[i] === 'r' ? pad + cell : cell + pad;
      })
      .join('  ')
      .trimEnd(),
  );
}

/**
 * What a pipe or a file receives for a block: '' or text ending in a newline, so blocks
 * concatenate the way a program's output does. Styles, links and actions are dropped.
 */
export function plain(block: Block): string {
  switch (block.type) {
    case 'lines':
      return asLines(block.lines.map(lineText));
    case 'grid': {
      // Like `ls | cat`: one item per line, and its note after it, the notes lined up.
      const notes = block.notes;
      if (notes === undefined) return asLines(block.items.map((item) => item.text));
      const width = Math.max(0, ...block.items.map((item) => textWidth(item.text)));
      return asLines(
        block.items.map((item, i) => {
          const note = lineText(notes[i] ?? []);
          return note === '' ? item.text : `${item.text}${' '.repeat(width - textWidth(item.text) + 2)}${note}`;
        }),
      );
    }
    case 'table':
      return asLines(tableRows(block));
    case 'art':
      return terminated(block.text);
    case 'panel':
      return asLines([...(block.title === undefined ? [] : [block.title]), ...block.body.map(lineText)]);
    case 'chips':
      return '';
    case 'card':
      // The link as it would be pasted: the address for mail, the whole URL for the web.
      return asLines([block.title, block.copy ?? block.href, ...(block.detail === undefined ? [] : [block.detail])]);
    case 'columns':
      return [...block.left, ...block.right].map(plain).join('');
    case 'component':
      return terminated(block.plain);
    case 'legacyHtml':
      return terminated(htmlToText(block.html));
  }
}
