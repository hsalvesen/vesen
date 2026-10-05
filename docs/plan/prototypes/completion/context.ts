import { lex, type Token, type Quote } from './lexer.ts';
export interface Spec { name: string; subcommands?: Spec[]; options?: {short?: string; long?: string; takesValue?: boolean}[]; args?: {name: string; completer: string; variadic?: boolean}[] }
export type Position =
  | { kind: 'commandName' }
  | { kind: 'subcommand'; spec: Spec }
  | { kind: 'option'; spec: Spec }
  | { kind: 'optionValue'; spec: Spec; option: string }
  | { kind: 'argument'; spec: Spec; argIndex: number; completer: string | null }
  | { kind: 'redirectTarget' }
  | { kind: 'unknownCommand'; name: string };
export interface Ctx { word: { start: number; end: number; value: string; quote: Quote }; position: Position; commandPath: string[] }
export function analyze(line: string, cursor: number, registry: Map<string, Spec>): Ctx {
  const head = line.slice(0, cursor);
  const toks = lex(head);
  const last = toks[toks.length - 1];
  const inWord = !!last && last.kind === 'word' && last.end === cursor && !(/\s$/.test(head) && !last.openQuote);
  const word = inWord ? { start: last.start, end: cursor, value: last.value, quote: last.openQuote } : { start: cursor, end: cursor, value: '', quote: null as Quote };
  const before = inWord ? toks.slice(0, -1) : toks;
  // find start of current simple command
  let s = before.length - 1;
  while (s >= 0 && !(before[s].kind === 'op' && ['|', '&&', '||', ';'].includes(before[s].raw))) s--;
  let seg = before.slice(s + 1);
  const prev = seg[seg.length - 1];
  if (prev && prev.kind === 'op') return { word, position: { kind: 'redirectTarget' }, commandPath: [] };
  // drop redirections + their targets
  const argv: string[] = [];
  for (let k = 0; k < seg.length; k++) { if (seg[k].kind === 'op') { k++; continue; } argv.push(seg[k].value); }
  // sudo / commandLine recursion
  while (argv[0] === 'sudo') argv.shift();
  if (argv.length === 0) return { word, position: { kind: 'commandName' }, commandPath: [] };
  let spec = registry.get(argv[0]);
  if (!spec) return { word, position: { kind: 'unknownCommand', name: argv[0] }, commandPath: [argv[0]] };
  const path = [spec.name];
  let positional = 0; let i = 1; let endOfOpts = false;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (!endOfOpts && a === '--') { endOfOpts = true; continue; }
    if (!endOfOpts && a.startsWith('-') && a.length > 1) {
      const o = spec.options?.find((o) => a === '--' + o.long || a === '-' + o.short);
      if (o?.takesValue && !a.includes('=')) { i++; if (i >= argv.length) return { word, position: { kind: 'optionValue', spec, option: a }, commandPath: path }; }
      continue;
    }
    if (positional === 0 && spec.subcommands) { const sub = spec.subcommands.find((x) => x.name === a); if (sub) { spec = sub; path.push(sub.name); continue; } }
    positional++;
  }
  if (!endOfOpts && word.value.startsWith('-') && !word.quote) return { word, position: { kind: 'option', spec }, commandPath: path };
  if (positional === 0 && spec.subcommands) return { word, position: { kind: 'subcommand', spec }, commandPath: path };
  const args = spec.args ?? [];
  const argSpec = args[Math.min(positional, args.length - 1)];
  const completer = argSpec && (positional < args.length || argSpec.variadic) ? argSpec.completer : null;
  return { word, position: { kind: 'argument', spec, argIndex: positional, completer }, commandPath: path };
}
