// fnmatch(3) as find's -name, -iname and -path and tree's -I match: * ? and [...] (with [!x],
// [^x], ranges and [:classes:]) over the whole string, where a leading dot and a '/' are
// ordinary characters, unlike the shell's pathname expansion (shell/glob.ts). A wildcard pattern
// is not a regular expression: the matcher goes back no further than the last star, so no
// pattern a visitor types can take more than a pass per star, or freeze the page.
//
// It is the shell's matcher written again rather than imported, so the catalogue's bodies that use
// it do not split shell/glob.ts out of the kernel's chunk.

type Item = { readonly from: number; readonly to: number } | ((c: string) => boolean);

type Atom =
  | { readonly t: 'lit'; readonly c: string }
  | { readonly t: 'any' }
  | { readonly t: 'star' }
  | { readonly t: 'class'; readonly negate: boolean; readonly items: readonly Item[] };

const NAMED: Readonly<Record<string, (c: string) => boolean>> = {
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

const code = (c: string): number => c.codePointAt(0) ?? 0;

/** A bracket expression at chars[i] === '[': the atom and where it ends, or null for a lone '['. */
function bracket(chars: readonly string[], i: number): { atom: Atom; next: number } | null {
  let j = i + 1;
  const negate = chars[j] === '!' || chars[j] === '^';
  if (negate) j += 1;
  const items: Item[] = [];
  for (let first = true; j < chars.length; first = false) {
    let c = chars[j] ?? '';
    if (c === ']' && !first) return { atom: { t: 'class', negate, items }, next: j + 1 };
    if (c === '[' && chars[j + 1] === ':') {
      const close = chars.indexOf(':', j + 2);
      const named = close === -1 || chars[close + 1] !== ']' ? undefined : NAMED[chars.slice(j + 2, close).join('')];
      if (named !== undefined) {
        items.push(named);
        j = close + 2;
        continue;
      }
    }
    if (c === '\\' && j + 1 < chars.length) {
      j += 1;
      c = chars[j] ?? '';
    }
    const end = chars[j + 2];
    if (chars[j + 1] === '-' && end !== undefined && end !== ']') {
      items.push({ from: code(c), to: code(end) });
      j += 3;
      continue;
    }
    items.push({ from: code(c), to: code(c) });
    j += 1;
  }
  return null;
}

function compile(pattern: string): Atom[] {
  const chars = Array.from(pattern);
  const atoms: Atom[] = [];
  for (let i = 0; i < chars.length; ) {
    const c = chars[i] ?? '';
    const found = c === '[' ? bracket(chars, i) : null;
    if (found !== null) {
      atoms.push(found.atom);
      i = found.next;
    } else if (c === '\\' && i + 1 < chars.length) {
      atoms.push({ t: 'lit', c: chars[i + 1] ?? '' });
      i += 2;
    } else {
      if (c === '*') {
        if (atoms[atoms.length - 1]?.t !== 'star') atoms.push({ t: 'star' });
      } else atoms.push(c === '?' ? { t: 'any' } : { t: 'lit', c });
      i += 1;
    }
  }
  return atoms;
}

function one(atom: Atom, c: string): boolean {
  if (atom.t === 'lit') return atom.c === c;
  if (atom.t === 'any') return true;
  if (atom.t === 'star') return false;
  const n = code(c);
  const hit = atom.items.some((item) => (typeof item === 'function' ? item(c) : n >= item.from && n <= item.to));
  return hit !== atom.negate;
}

/** True when `text` matches the shell pattern `pattern`; `caseFold` ignores case, as -iname does. */
export function fnmatch(pattern: string, text: string, caseFold = false): boolean {
  const atoms = compile(caseFold ? pattern.toLowerCase() : pattern);
  const s = Array.from(caseFold ? text.toLowerCase() : text);
  let p = 0;
  let i = 0;
  let starP = -1;
  let starI = 0;
  while (i < s.length) {
    const atom = atoms[p];
    if (atom !== undefined && atom.t !== 'star' && one(atom, s[i] ?? '')) {
      p += 1;
      i += 1;
    } else if (atom?.t === 'star') {
      starP = p;
      starI = i;
      p += 1;
    } else if (starP !== -1) {
      // Let the last star take one more character, and try again from there.
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

/** tree's -I and -P: alternatives separated by `|`, any of which may match. */
export function matchesAny(patterns: readonly string[], name: string): boolean {
  return patterns.some((pattern) => pattern.split('|').some((alternative) => alternative !== '' && fnmatch(alternative, name)));
}
