export type Quote = null | '"' | "'";
export interface Token {
  kind: 'word' | 'op';
  raw: string; value: string; start: number; end: number;
  openQuote: Quote; // non-null if the line ends inside this word's quote
  quoted: boolean;
}
const OPS = ['&&', '||', '>>', '2>', '|', ';', '>', '<'];
export function lex(line: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '#' ) { break; }
    const op = OPS.find((o) => line.startsWith(o, i) && !(o === '2>' && toks.length && toks[toks.length-1].end === i));
    if (op) { toks.push({ kind: 'op', raw: op, value: op, start: i, end: i + op.length, openQuote: null, quoted: false }); i += op.length; continue; }
    const start = i; let value = ''; let quote: Quote = null; let quoted = false;
    while (i < line.length) {
      const ch = line[i];
      if (quote === "'") { if (ch === "'") { quote = null; i++; continue; } value += ch; i++; continue; }
      if (quote === '"') {
        if (ch === '"') { quote = null; i++; continue; }
        if (ch === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) { value += line[i + 1]; i += 2; continue; }
        value += ch; i++; continue;
      }
      if (ch === ' ' || ch === '\t') break;
      if (OPS.some((o) => o !== '2>' && line.startsWith(o, i))) break;
      if (ch === "'" || ch === '"') { quote = ch; quoted = true; i++; continue; }
      if (ch === '\\') { if (i + 1 < line.length) { value += line[i + 1]; i += 2; } else { i++; } continue; }
      value += ch; i++;
    }
    toks.push({ kind: 'word', raw: line.slice(start, i), value, start, end: i, openQuote: quote, quoted });
  }
  return toks;
}
