import { escapeWord } from './engine.ts';
import type { Ctx } from './context.ts';
// Raw-preserving insertion: keep what the user typed verbatim, escape only the new tail.
export function applyRaw(line: string, ctx: Ctx, rawTyped: string, value: string, suffix: string) {
  const q = ctx.word.quote; const typed = ctx.word.value;
  let body: string;
  if (value.startsWith(typed)) body = rawTyped + escapeWord(value.slice(typed.length), q);
  else body = (q ?? '') + (value.startsWith('~/') ? '~/' + escapeWord(value.slice(2), q) : escapeWord(value, q));
  const closes = q && suffix === ' ' ? q : '';
  const ins = body + closes + suffix;
  return { line: line.slice(0, ctx.word.start) + ins + line.slice(ctx.word.end), cursor: ctx.word.start + ins.length };
}
