import { lex, type Token, type Word, type Op, ShellSyntaxError } from './lexer.ts';
export type RedirOp = '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '2>&1';
export interface Redirect { op: RedirOp; target?: Word }
export interface SimpleCommand { type: 'simple'; assigns: { name: string; value: Word }[]; words: Word[]; redirects: Redirect[] }
export interface Pipeline { type: 'pipeline'; commands: SimpleCommand[]; negated: boolean }
export interface AndOr { type: 'andor'; first: Pipeline; rest: { op: '&&' | '||'; pipeline: Pipeline }[] }
export interface Script { type: 'script'; items: AndOr[] }

export function parse(src: string): Script {
  const toks = lex(src); let p = 0;
  const peek = () => toks[p]; const isOp = (o: Op) => toks[p]?.t === 'op' && (toks[p] as any).op === o;
  const items: AndOr[] = [];
  while (p < toks.length) {
    if (isOp(';')) { p++; continue; }
    items.push(andOr());
    if (p < toks.length) { if (isOp(';') || isOp('&')) p++; else throw new ShellSyntaxError(`syntax error near unexpected token`, (peek() as any).start); }
  }
  return { type: 'script', items };
  function andOr(): AndOr {
    const first = pipeline(); const rest: AndOr['rest'] = [];
    while (isOp('&&') || isOp('||')) { const op = (toks[p++] as any).op; if (p >= toks.length) throw new ShellSyntaxError(`syntax error: unexpected end after \`${op}'`, src.length, true); rest.push({ op, pipeline: pipeline() }); }
    return { type: 'andor', first, rest };
  }
  function pipeline(): Pipeline {
    let negated = false;
    const t = peek(); if (t?.t === 'word' && t.word.parts.length === 1 && t.word.parts[0].kind === 'lit' && !t.word.parts[0].quoted && t.word.parts[0].text === '!') { negated = true; p++; }
    const commands = [simple()];
    while (isOp('|')) { p++; if (p >= toks.length) throw new ShellSyntaxError('syntax error: unexpected end after `|\'', src.length, true); commands.push(simple()); }
    return { type: 'pipeline', commands, negated };
  }
  function simple(): SimpleCommand {
    const cmd: SimpleCommand = { type: 'simple', assigns: [], words: [], redirects: [] };
    while (p < toks.length) {
      const t = toks[p];
      if (t.t === 'op') {
        if (['>', '>>', '<', '2>', '2>>', '&>'].includes(t.op)) { p++; const w = toks[p]; if (!w || w.t !== 'word') throw new ShellSyntaxError(`syntax error near unexpected token \`${w ? (w as any).op : 'newline'}'`, t.end); cmd.redirects.push({ op: t.op as RedirOp, target: w.word }); p++; continue; }
        if (t.op === '2>&1') { cmd.redirects.push({ op: '2>&1' }); p++; continue; }
        break;
      }
      const w = t.word; const lit0 = w.parts[0];
      const m = cmd.words.length === 0 && lit0?.kind === 'lit' && !lit0.quoted ? /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(lit0.text) : null;
      if (m) { const rest = lit0.text.slice(m[0].length); cmd.assigns.push({ name: m[1], value: { ...w, parts: [...(rest ? [{ ...lit0, text: rest }] : []), ...w.parts.slice(1)] } }); p++; continue; }
      cmd.words.push(w); p++;
    }
    if (!cmd.words.length && !cmd.assigns.length && !cmd.redirects.length) throw new ShellSyntaxError(`syntax error near unexpected token \`${(toks[p] as any)?.op ?? 'newline'}'`, (toks[p] as any)?.start ?? src.length);
    return cmd;
  }
}
