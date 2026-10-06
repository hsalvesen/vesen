// The command registry (docs/plan/02-architecture-and-contracts.md, section 1). A Map, so names
// such as `constructor` or `__proto__` are never found by accident (F031), and registration
// throws on a duplicate name or alias rather than letting one command silently replace another
// (F034).

import { lex } from './lexer';
import type { Category, CommandSpec, Registry } from './types';

/** The order help lists the categories in: the portfolio first. */
export const CATEGORY_ORDER: readonly Category[] = ['portfolio', 'files', 'text', 'shell', 'system', 'network', 'fun', 'editor'];

export const MAX_SUMMARY = 50;

/** Commands people type from other systems, and what vesen has instead. */
const ELSEWHERE: Readonly<Record<string, { readonly use?: string; readonly hint?: string }>> = {
  vim: { use: 'nano' },
  vi: { use: 'nano' },
  nvim: { use: 'nano' },
  emacs: { use: 'nano' },
  cls: { use: 'clear' },
  apt: { hint: 'vesen has no package manager.' },
  'apt-get': { hint: 'vesen has no package manager.' },
  yum: { hint: 'vesen has no package manager.' },
  dnf: { hint: 'vesen has no package manager.' },
  brew: { hint: 'vesen has no package manager.' },
  pacman: { hint: 'vesen has no package manager.' },
  snap: { hint: 'vesen has no package manager.' },
};

/**
 * The optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions):
 * the fewest insertions, deletions, substitutions and swaps of neighbours turning a into b.
 */
export function editDistance(a: string, b: string): number {
  const s = Array.from(a);
  const t = Array.from(b);
  const rows: number[][] = [];
  for (let i = 0; i <= s.length; i += 1) {
    const row: number[] = [i];
    for (let j = 1; j <= t.length; j += 1) row.push(i === 0 ? j : 0);
    rows.push(row);
  }
  const at = (i: number, j: number): number => rows[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= s.length; i += 1) {
    const row = rows[i] ?? [];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      row[j] = best;
    }
  }
  return at(s.length, t.length);
}

const VALID_NAME = /^[^\s/'"`$\\|&;<>()]+$/;

export class CommandRegistry implements Registry {
  /** Every name and alias, to the spec that owns it. */
  private readonly lookup = new Map<string, CommandSpec>();
  /** Each spec once, by its name. */
  private readonly specs = new Map<string, CommandSpec>();

  constructor(specs: readonly CommandSpec[] = []) {
    for (const spec of specs) this.register(spec);
  }

  register(spec: CommandSpec): void {
    const names = [spec.name, ...(spec.aliases ?? [])];
    for (const name of names) {
      if (!VALID_NAME.test(name)) throw new Error(`registry: '${name}' is not a valid command name`);
      const taken = this.lookup.get(name);
      if (taken !== undefined) {
        const what = taken.name === name ? 'a command' : `an alias of '${taken.name}'`;
        throw new Error(`registry: '${name}' is already registered as ${what}`);
      }
    }
    if (new Set(names).size !== names.length) throw new Error(`registry: '${spec.name}' lists the same name twice`);
    for (const name of names) this.lookup.set(name, spec);
    this.specs.set(spec.name, spec);
  }

  get(nameOrAlias: string): CommandSpec | undefined {
    return this.lookup.get(nameOrAlias);
  }

  list(options: { includeHidden?: boolean; category?: Category } = {}): CommandSpec[] {
    return [...this.specs.values()]
      .filter((spec) => (options.includeHidden || !spec.hidden) && (options.category === undefined || spec.category === options.category))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  names(options: { includeHidden?: boolean } = {}): string[] {
    return this.list(options)
      .flatMap((spec) => [spec.name, ...(spec.aliases ?? [])])
      .sort((a, b) => a.localeCompare(b));
  }

  suggest(name: string): { near: string[]; hint?: string } {
    const elsewhere = Object.prototype.hasOwnProperty.call(ELSEWHERE, name) ? ELSEWHERE[name] : undefined;
    if (elsewhere !== undefined) {
      const use = elsewhere.use !== undefined && this.lookup.has(elsewhere.use) ? [elsewhere.use] : [];
      if (use.length > 0 || elsewhere.hint !== undefined) {
        return elsewhere.hint === undefined ? { near: use } : { near: use, hint: elsewhere.hint };
      }
    }

    const lower = name.toLowerCase();
    const candidates = this.names();
    const sameCase = candidates.filter((candidate) => candidate.toLowerCase() === lower);
    if (sameCase.length > 0) return { near: sameCase.slice(0, 3) };

    // Short names would match nearly anything at distance 2.
    const limit = Array.from(lower).length <= 3 ? 1 : 2;
    const scored = candidates
      .map((candidate) => ({ candidate, distance: editDistance(lower, candidate.toLowerCase()) }))
      .filter(({ distance }) => distance <= limit)
      .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
    const near = scored.map(({ candidate }) => candidate);
    if (near.length === 0 && Array.from(lower).length >= 2) {
      for (const candidate of candidates) if (candidate.toLowerCase().startsWith(lower)) near.push(candidate);
    }
    return { near: near.slice(0, 3) };
  }

  validate(): string[] {
    const problems: string[] = [];
    for (const spec of this.specs.values()) {
      const where = `${spec.name}:`;
      if (spec.summary.length > MAX_SUMMARY) problems.push(`${where} summary is longer than ${MAX_SUMMARY} characters`);
      if ((spec.run === undefined) === (spec.load === undefined)) problems.push(`${where} needs exactly one of run and load`);
      const args = spec.args ?? [];
      args.forEach((arg, i) => {
        if (arg.variadic && i !== args.length - 1) problems.push(`${where} only the last argument may be variadic (${arg.name})`);
      });
      const seen = new Set<string>();
      for (const flag of spec.flags ?? []) {
        if (flag.description.trim() === '') problems.push(`${where} flag ${flag.long ?? flag.short} has no description`);
        for (const spelling of [flag.short && `-${flag.short}`, flag.long && `--${flag.long}`]) {
          if (!spelling) continue;
          if (seen.has(spelling)) problems.push(`${where} flag ${spelling} is defined twice`);
          seen.add(spelling);
        }
      }
      for (const example of spec.examples ?? []) {
        if (!lex(example.line).complete) problems.push(`${where} example '${example.line}' does not lex`);
      }
    }
    return problems;
  }
}
