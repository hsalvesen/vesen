// The command registry (docs/plan/02-architecture-and-contracts.md, section 1). A Map, so names
// such as `constructor` or `__proto__` are never found by accident (F031), and registration
// throws on a duplicate name or alias rather than letting one command silently replace another
// (F034).

import { lex } from './lexer';
import type { CatalogueLoader, Category, CommandSpec, Registry } from './types';

/** The order help lists the categories in: the portfolio first. */
export const CATEGORY_ORDER: readonly Category[] = ['portfolio', 'files', 'text', 'shell', 'system', 'network', 'fun', 'editor'];

export const MAX_SUMMARY = 50;

const NO_EDITOR = "vesen has no editor yet: 'cat FILE' shows a file, and 'echo TEXT > FILE' writes one.";
const NO_PACKAGES = 'vesen has no package manager.';

/** Linux commands visitors try that vesen does not have yet; each gets a plain hint. */
const NOT_YET = [
  'grep', 'egrep', 'head', 'tail', 'less', 'more', 'wc', 'sort', 'uniq', 'cut', 'tr', 'sed', 'awk',
  'find', 'tree', 'diff', 'xargs', 'tee', 'chmod', 'chown', 'ps', 'top', 'htop', 'kill',
];

/** Commands people type from other systems, and what vesen has instead. */
const ELSEWHERE: Readonly<Record<string, { readonly use?: string; readonly hint?: string }>> = {
  ...Object.fromEntries(NOT_YET.map((name) => [name, { hint: `${name} isn't in vesen yet.` }])),
  vim: { use: 'nano', hint: NO_EDITOR },
  vi: { use: 'nano', hint: NO_EDITOR },
  nvim: { use: 'nano', hint: NO_EDITOR },
  emacs: { use: 'nano', hint: NO_EDITOR },
  nano: { hint: NO_EDITOR },
  cls: { use: 'clear' },
  apt: { hint: NO_PACKAGES },
  'apt-get': { hint: NO_PACKAGES },
  yum: { hint: NO_PACKAGES },
  dnf: { hint: NO_PACKAGES },
  brew: { hint: NO_PACKAGES },
  pacman: { hint: NO_PACKAGES },
  snap: { hint: NO_PACKAGES },
};

/**
 * Commands a tap on a guess must never run: they open a page or a mail client, take over the
 * page, spend real data (speedtest), or end the session. A name typed differently only in case
 * still finds them.
 */
const NEVER_GUESSED = new Set(['reset', 'exit', 'logout', 'login']);

function guessable(spec: CommandSpec): boolean {
  return spec.opens === undefined && spec.interactiveOnly !== true && spec.dataCost === undefined && !NEVER_GUESSED.has(spec.name);
}

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

/** How long a lookup waits for the catalogue (on top of ^C) before it goes on without it. */
export const CATALOGUE_WAIT_MS = 8000;

/**
 * Waits until every command is registered, at most `ms` and never past `signal`. True when they
 * all are; false when the catalogue failed to load, took too long or the wait was interrupted.
 */
export async function settleCommands(
  registry: Pick<Registry, 'complete' | 'whenComplete'>,
  signal?: AbortSignal,
  ms: number = CATALOGUE_WAIT_MS,
): Promise<boolean> {
  if (registry.complete) return true;
  if (signal?.aborted === true) return false;
  let stop = (): void => {};
  const gaveUp = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const aborted = (): void => resolve();
    signal?.addEventListener('abort', aborted, { once: true });
    stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      resolve();
    };
  });
  try {
    await Promise.race([registry.whenComplete(), gaveUp]);
  } finally {
    stop();
  }
  return registry.complete;
}

/** The specs that came with the catalogue, rather than the kernel. */
const FROM_CATALOGUE = new WeakSet<CommandSpec>();

/**
 * True for a command that came with the catalogue (src/commands/more): help's short index names
 * it only when it is `featured`, and counts the rest, so the index still fits a phone's screen.
 */
export function fromCatalogue(spec: CommandSpec): boolean {
  return FROM_CATALOGUE.has(spec);
}

/** What a lookup says, once, when the catalogue could not be loaded. */
export function catalogueFailure(reason: string): string {
  return `Some of vesen's commands could not be loaded (${reason}). The next command will try again.`;
}

export interface RegistryOptions {
  /**
   * The commands that load after the kernel (src/commands/more): registered when whenComplete()
   * is first called, on idle or on demand.
   */
  readonly catalogue?: CatalogueLoader | null;
}

/** The catalogue's state: not asked for, on its way, in, or failed (with why, and whether that was said). */
type CatalogueState =
  | { readonly kind: 'idle'; readonly load: CatalogueLoader }
  | { readonly kind: 'loading'; readonly load: CatalogueLoader; readonly done: Promise<void> }
  | { readonly kind: 'failed'; readonly load: CatalogueLoader; readonly reason: string; reported: boolean }
  | { readonly kind: 'complete' };

export class CommandRegistry implements Registry {
  /** Every name and alias, to the spec that owns it. */
  private readonly lookup = new Map<string, CommandSpec>();
  /** Each spec once, by its name. */
  private readonly specs = new Map<string, CommandSpec>();
  private catalogue: CatalogueState;
  /** The names of stand-ins, which a catalogue command of the same name or alias replaces. */
  private readonly standIns = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(specs: readonly CommandSpec[] = [], options: RegistryOptions = {}) {
    for (const spec of specs) this.register(spec);
    this.catalogue = options.catalogue ? { kind: 'idle', load: options.catalogue } : { kind: 'complete' };
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

  /**
   * Registers a stand-in, as tests do for commands not written yet: a catalogue command of the
   * same name or alias replaces it when the catalogue arrives, as a spec file replaces it in
   * buildRegistry (src/commands/index.ts).
   */
  registerStandIn(spec: CommandSpec): void {
    this.register(spec);
    this.standIns.add(spec.name);
  }

  // ── The catalogue ──

  get complete(): boolean {
    return this.catalogue.kind === 'complete';
  }

  whenComplete(): Promise<void> {
    const state = this.catalogue;
    if (state.kind === 'complete') return Promise.resolve();
    if (state.kind === 'loading') return state.done;
    const done = this.loadCatalogue(state.load);
    // Unless the loader settled at once, the attempt is now in flight.
    if (this.catalogue === state) this.catalogue = { kind: 'loading', load: state.load, done };
    return done;
  }

  takeFailure(): string | undefined {
    const state = this.catalogue;
    if (state.kind !== 'failed' || state.reported) return undefined;
    state.reported = true;
    return state.reason;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async loadCatalogue(load: CatalogueLoader): Promise<void> {
    let specs: readonly CommandSpec[];
    try {
      specs = await load();
      this.addCatalogue(specs);
    } catch (error) {
      const reason = error instanceof Error && error.message !== '' ? error.message : String(error);
      this.catalogue = { kind: 'failed', load, reason, reported: false };
      return;
    }
    this.catalogue = { kind: 'complete' };
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // One listener failing must not stop the others hearing the commands arrive.
      }
    }
  }

  /**
   * Registers the catalogue's commands all together, or none of them: a stand-in of the same
   * name gives way, and any other clash throws, leaving the registry as it was.
   */
  private addCatalogue(specs: readonly CommandSpec[]): void {
    const replaced = new Set<CommandSpec>();
    for (const spec of specs) {
      for (const name of [spec.name, ...(spec.aliases ?? [])]) {
        const taken = this.lookup.get(name);
        if (taken !== undefined && this.standIns.has(taken.name)) replaced.add(taken);
      }
    }
    const scratch = new CommandRegistry([...this.specs.values()].filter((spec) => !replaced.has(spec)));
    for (const spec of specs) scratch.register(spec);
    for (const spec of replaced) {
      this.specs.delete(spec.name);
      this.standIns.delete(spec.name);
      for (const name of [spec.name, ...(spec.aliases ?? [])]) if (this.lookup.get(name) === spec) this.lookup.delete(name);
    }
    for (const spec of specs) {
      this.register(spec);
      FROM_CATALOGUE.add(spec);
    }
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

    // Short names would match nearly anything at distance 2, so it takes five letters and the
    // same first letter: grep is not a typo of repo, nor tail of email.
    const length = Array.from(lower).length;
    // Only names that start with a letter: `e` is not a typo of `:`, nor `,` of `.`.
    const fuzzy = candidates.filter((candidate) => {
      const spec = this.lookup.get(candidate);
      return spec !== undefined && guessable(spec) && /^[a-z]/i.test(candidate);
    });
    const scored = fuzzy
      .map((candidate) => ({ candidate, distance: editDistance(lower, candidate.toLowerCase()) }))
      .filter(({ candidate, distance }) => distance <= 1 || (distance === 2 && length >= 5 && candidate.toLowerCase().charAt(0) === lower.charAt(0)))
      .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
    const near = scored.map(({ candidate }) => candidate);
    if (near.length === 0 && length >= 2) {
      for (const candidate of fuzzy) if (candidate.toLowerCase().startsWith(lower)) near.push(candidate);
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
