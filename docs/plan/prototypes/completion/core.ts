// Prototype: lexer + cursor context + matching + apply. Not repo code.
export type Quote = 'none' | 'single' | 'double';
export interface Token { kind: 'word' | 'op'; raw: string; value: string; start: number; end: number; quote: Quote; }
const OPS = ['2>>', '2>&1', '&>', '>>', '||', '&&', '2>', '|', ';', '&', '>', '<'];

export function lex(line: string): { tokens: Token[]; open: Quote } {
  const tokens: Token[] = [];
  let i = 0;
  let open: Quote = 'none';
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    const op = OPS.find((o) => line.startsWith(o, i) && !(o.startsWith('2') && i > 0 && !/\s/.test(line[i - 1])));
    if (op) { tokens.push({ kind: 'op', raw: op, value: op, start: i, end: i + op.length, quote: 'none' }); i += op.length; continue; }
    const start = i; let value = ''; let q: Quote = 'none';
    while (i < line.length) {
      const c = line[i];
      if (q === 'none') {
        if (c === ' ' || c === '\t') break;
        if (OPS.some((o) => !o.startsWith('2') && line.startsWith(o, i))) break;
        if (c === '\\') { if (i + 1 < line.length) { value += line[i + 1]; i += 2; } else { i++; } continue; }
        if (c === "'") { q = 'single'; i++; continue; }
        if (c === '"') { q = 'double'; i++; continue; }
        value += c; i++;
      } else if (q === 'single') {
        if (c === "'") { q = 'none'; i++; continue; }
        value += c; i++;
      } else {
        if (c === '"') { q = 'none'; i++; continue; }
        if (c === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) { value += line[i + 1]; i += 2; continue; }
        value += c; i++;
      }
    }
    tokens.push({ kind: 'word', raw: line.slice(start, i), value, start, end: i, quote: q });
    open = q;
  }
  return { tokens, open };
}

export interface Ctx { words: Token[]; wordIndex: number; fragment: string; from: number; to: number; quote: Quote; afterRedirect: boolean; }
export function cursorContext(line: string, cursor: number): Ctx {
  const { tokens } = lex(line.slice(0, cursor));
  // segment = tokens after the last separator op (| ; && || &)
  let segStart = 0;
  tokens.forEach((t, idx) => { if (t.kind === 'op' && ['|', ';', '&&', '||', '&'].includes(t.value)) segStart = idx + 1; });
  const seg = tokens.slice(segStart);
  const last = seg[seg.length - 1];
  const inWord = !!last && last.kind === 'word' && last.end === cursor;
  const words: Token[] = []; let afterRedirect = false;
  for (let k = 0; k < seg.length; k++) {
    const t = seg[k];
    if (t.kind === 'op') { // redirection: next word is its target, not an argument
      if (k === seg.length - 1 && !inWord) afterRedirect = true;
      if (k === seg.length - 2 && inWord) afterRedirect = true;
      k++; continue;
    }
    words.push(t);
  }
  if (inWord && !afterRedirect) {
    return { words, wordIndex: words.length - 1, fragment: last.value, from: last.start, to: cursor, quote: last.quote, afterRedirect };
  }
  if (inWord && afterRedirect) return { words, wordIndex: -1, fragment: last.value, from: last.start, to: cursor, quote: last.quote, afterRedirect };
  return { words, wordIndex: afterRedirect ? -1 : words.length, fragment: '', from: cursor, to: cursor, quote: 'none', afterRedirect };
}

export function smartMatch(cand: string, frag: string): boolean {
  return /[A-Z]/.test(frag) ? cand.startsWith(frag) : cand.toLowerCase().startsWith(frag.toLowerCase());
}
export function lcp(values: string[], ci: boolean): string {
  if (!values.length) return '';
  let p = values[0];
  for (const v of values.slice(1)) {
    let i = 0;
    while (i < p.length && i < v.length && (ci ? p[i].toLowerCase() === v[i].toLowerCase() : p[i] === v[i])) i++;
    p = p.slice(0, i);
  }
  // if case-insensitive LCP has mixed case across candidates, fall back to exact LCP
  if (ci && !values.every((v) => v.startsWith(p))) return lcp(values, false).length >= p.length ? lcp(values, false) : p.toLowerCase() === p ? p : lcp(values, false);
  return p;
}
export function quoteFor(value: string, quote: Quote): string {
  if (quote === 'single') return value.replace(/'/g, `'\\''`);
  if (quote === 'double') return value.replace(/(["\\$`])/g, '\\$1');
  return value.replace(/([\s'"\\$`|&;<>()*?\[\]#~!{}])/g, (m, c, off) => (c === '~' && off !== 0 ? c : '\\' + c));
}
export function apply(line: string, c: Ctx, value: string, suffix: string, closeQuote: boolean): { line: string; cursor: number } {
  let ins = quoteFor(value, c.quote);
  const raw = line.slice(c.from, c.to);
  // keep the user's opening quote if they typed one
  const lead = raw.startsWith("'") ? "'" : raw.startsWith('"') ? '"' : '';
  if (lead) ins = lead + ins;
  if (closeQuote && c.quote !== 'none') ins += c.quote === 'single' ? "'" : '"';
  ins += suffix;
  return { line: line.slice(0, c.from) + ins + line.slice(c.to), cursor: c.from + ins.length };
}
