// Pathname expansion: * ? [abc] [a-z] [!x] [^x] [[:alpha:]] and backslash escapes, matched one
// path segment at a time against an injected directory lister, so it works on any file system
// (the VFS in the app, a plain object in tests).
//
// As in bash:
// - a name starting with '.' matches only when the pattern segment starts with a literal '.',
//   and '.' and '..' are never produced;
// - `/` is never matched by a wildcard;
// - the matches are sorted;
// - a pattern that matches nothing gives no results, and the caller keeps the word as typed.
//
// The expander escapes quoted characters with a backslash before calling in, so `"*".txt`
// matches only a file literally named `*.txt`.

/** What globbing needs from a file system. Paths are absolute. */
export interface GlobFs {
  /** The names in a directory, without '.' and '..'; null when it is not a directory or not readable. */
  readdir(path: string): readonly string[] | null;
  /** True when something exists at the path (following symbolic links). */
  exists(path: string): boolean;
  /** True when the path is a directory (following symbolic links). */
  isDirectory(path: string): boolean;
}

/** Expands one pattern to the sorted paths it matches, or none. Built by createGlobber. */
export type GlobMatcher = (pattern: string) => readonly string[];

type ClassItem =
  | { readonly t: 'char'; readonly c: string }
  | { readonly t: 'range'; readonly from: number; readonly to: number }
  | { readonly t: 'named'; readonly test: (c: string) => boolean };

type Atom =
  | { readonly t: 'lit'; readonly c: string }
  | { readonly t: 'any' }
  | { readonly t: 'star' }
  | { readonly t: 'class'; readonly negate: boolean; readonly items: readonly ClassItem[] };

const NAMED_CLASSES: Readonly<Record<string, (c: string) => boolean>> = {
  alpha: (c) => /^\p{L}$/u.test(c),
  digit: (c) => c >= '0' && c <= '9',
  alnum: (c) => /^[\p{L}\p{N}]$/u.test(c),
  upper: (c) => /^\p{Lu}$/u.test(c),
  lower: (c) => /^\p{Ll}$/u.test(c),
  space: (c) => /^\s$/.test(c),
  blank: (c) => c === ' ' || c === '\t',
  punct: (c) => /^[!-/:-@[-`{-~]$/.test(c),
  xdigit: (c) => /^[0-9A-Fa-f]$/.test(c),
  print: (c) => c >= ' ' && c !== '\x7f',
  graph: (c) => c > ' ' && c !== '\x7f',
  cntrl: (c) => c < ' ' || c === '\x7f',
};

/**
 * Reads a bracket expression starting at chars[i] === '['. Returns the atom and the index after
 * the closing ']', or null when there is no closing bracket (the '[' is then literal).
 */
function readClass(chars: readonly string[], i: number): { atom: Atom; next: number } | null {
  let j = i + 1;
  let negate = false;
  if (chars[j] === '!' || chars[j] === '^') {
    negate = true;
    j += 1;
  }
  const items: ClassItem[] = [];
  let first = true;
  while (j < chars.length) {
    let c = chars[j] ?? '';
    if (c === ']' && !first) return { atom: { t: 'class', negate, items }, next: j + 1 };
    first = false;
    if (c === '[' && chars[j + 1] === ':') {
      const close = chars.indexOf(':', j + 2);
      if (close !== -1 && chars[close + 1] === ']') {
        const test = NAMED_CLASSES[chars.slice(j + 2, close).join('')];
        if (test !== undefined) {
          items.push({ t: 'named', test });
          j = close + 2;
          continue;
        }
      }
    }
    if (c === '\\' && j + 1 < chars.length) {
      j += 1;
      c = chars[j] ?? '';
    }
    const dash = chars[j + 1];
    const end = chars[j + 2];
    if (dash === '-' && end !== undefined && end !== ']') {
      let to = end;
      let skip = 3;
      if (to === '\\' && chars[j + 3] !== undefined) {
        to = chars[j + 3] ?? to;
        skip = 4;
      }
      items.push({ t: 'range', from: c.codePointAt(0) ?? 0, to: to.codePointAt(0) ?? 0 });
      j += skip;
      continue;
    }
    items.push({ t: 'char', c });
    j += 1;
  }
  return null;
}

/** Compiles one path segment of a pattern. */
function compile(segment: string): Atom[] {
  const chars = Array.from(segment);
  const atoms: Atom[] = [];
  for (let i = 0; i < chars.length; ) {
    const c = chars[i] ?? '';
    if (c === '\\' && i + 1 < chars.length) {
      atoms.push({ t: 'lit', c: chars[i + 1] ?? '' });
      i += 2;
    } else if (c === '*') {
      if (atoms[atoms.length - 1]?.t !== 'star') atoms.push({ t: 'star' });
      i += 1;
    } else if (c === '?') {
      atoms.push({ t: 'any' });
      i += 1;
    } else if (c === '[') {
      const cls = readClass(chars, i);
      if (cls === null) {
        atoms.push({ t: 'lit', c });
        i += 1;
      } else {
        atoms.push(cls.atom);
        i = cls.next;
      }
    } else {
      atoms.push({ t: 'lit', c });
      i += 1;
    }
  }
  return atoms;
}

function matchesAtom(atom: Atom, c: string): boolean {
  if (atom.t === 'lit') return atom.c === c;
  if (atom.t === 'any') return true;
  if (atom.t === 'star') return false;
  const code = c.codePointAt(0) ?? 0;
  const hit = atom.items.some((item) =>
    item.t === 'char' ? item.c === c : item.t === 'range' ? code >= item.from && code <= item.to : item.test(c),
  );
  return hit !== atom.negate;
}

function matchAtoms(atoms: readonly Atom[], name: string): boolean {
  const s = Array.from(name);
  let p = 0;
  let i = 0;
  let starP = -1;
  let starI = 0;
  while (i < s.length) {
    const atom = atoms[p];
    if (atom !== undefined && atom.t !== 'star' && matchesAtom(atom, s[i] ?? '')) {
      p += 1;
      i += 1;
    } else if (atom?.t === 'star') {
      starP = p;
      starI = i;
      p += 1;
    } else if (starP !== -1) {
      p = starP + 1;
      starI += 1;
      i = starI;
    } else {
      return false;
    }
  }
  while (atoms[p]?.t === 'star') p += 1;
  return p === atoms.length;
}

/** True when an unescaped *, ? or a complete [...] makes `pattern` a glob. */
export function hasGlob(pattern: string): boolean {
  const chars = Array.from(pattern);
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (c === '\\') i += 1;
    else if (c === '*' || c === '?') return true;
    else if (c === '[' && readClass(chars, i) !== null) return true;
  }
  return false;
}

/** Backslash-escapes the characters globbing would treat specially, for quoted text. */
export function escapeGlob(text: string): string {
  return text.replace(/[\\*?[\]]/g, '\\$&');
}

/** Removes the backslash escapes from a pattern with no wildcards. */
export function unescapeGlob(text: string): string {
  return text.replace(/\\([\s\S])/g, '$1');
}

/**
 * True when `name` (one path segment) matches `pattern`, including the hidden-file rule: a name
 * starting with '.' needs a pattern starting with a literal '.'.
 */
export function globMatch(pattern: string, name: string): boolean {
  return segmentMatcher(pattern)(name);
}

/** Compiles a segment pattern once, for matching every name in a directory. */
function segmentMatcher(pattern: string): (name: string) => boolean {
  const atoms = compile(pattern);
  const first = atoms[0];
  const showsHidden = first?.t === 'lit' && first.c === '.';
  return (name) => (showsHidden || !name.startsWith('.')) && matchAtoms(atoms, name);
}

/** The sort key for names: letters and digits only, case folded, as an English locale sorts. */
function sortKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Orders file names the way `ls` and globs do in an English UTF-8 locale: punctuation such as a
 * leading dot is ignored at first, case is ignored next, and lower case comes before upper.
 */
export function compareNames(a: string, b: string): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/** Joins an absolute directory and one segment, resolving '.' and '..' logically. */
function joinPath(dir: string, name: string): string {
  if (name === '.') return dir;
  if (name === '..') {
    const cut = dir.replace(/\/+$/, '').lastIndexOf('/');
    return cut <= 0 ? '/' : dir.slice(0, cut);
  }
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`;
}

/** Joins what the user typed so far and one more segment. */
function joinShown(shown: string, name: string): string {
  if (shown === '') return name;
  return shown.endsWith('/') ? `${shown}${name}` : `${shown}/${name}`;
}

/**
 * Expands `pattern` against `fs`, relative to the absolute directory `cwd`. Results keep the
 * form typed: relative patterns give relative paths, absolute patterns absolute ones, and a
 * trailing '/' matches directories only and is kept. Returns [] when nothing matches.
 */
export function glob(pattern: string, cwd: string, fs: GlobFs): string[] {
  if (pattern === '') return [];
  const absolute = pattern.startsWith('/');
  const dirOnly = pattern.length > 1 && pattern.endsWith('/');
  const segments = pattern.split('/').filter((s) => s !== '');
  let found: { shown: string; abs: string }[] = [{ shown: absolute ? '/' : '', abs: absolute ? '/' : cwd }];
  segments.forEach((segment, k) => {
    const last = k === segments.length - 1;
    const next: { shown: string; abs: string }[] = [];
    for (const at of found) {
      if (!hasGlob(segment)) {
        const name = unescapeGlob(segment);
        const abs = joinPath(at.abs, name);
        if (last ? fs.exists(abs) : fs.isDirectory(abs)) next.push({ shown: joinShown(at.shown, name), abs });
        continue;
      }
      const names = fs.readdir(at.abs);
      if (names === null) continue;
      const matches = segmentMatcher(segment);
      for (const name of names) {
        if (name === '.' || name === '..' || name.includes('/') || !matches(name)) continue;
        const abs = joinPath(at.abs, name);
        if (!last && !fs.isDirectory(abs)) continue;
        next.push({ shown: joinShown(at.shown, name), abs });
      }
    }
    found = next;
  });
  if (segments.length === 0) return [];
  const results = (dirOnly ? found.filter((f) => fs.isDirectory(f.abs)).map((f) => `${f.shown}/`) : found.map((f) => f.shown));
  return results.sort(compareNames);
}

/** A matcher bound to a directory and a file system, for the expander. */
export function createGlobber(cwd: string, fs: GlobFs): GlobMatcher {
  return (pattern) => glob(pattern, cwd, fs);
}
