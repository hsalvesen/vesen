// File modes as GNU chmod reads them (gnulib's modechange), for chmod and find -perm:
//
//   MODE    := OCTAL | CLAUSE[,CLAUSE]...
//   CLAUSE  := [ugoa]*([-+=]([rwxXst]*|[ugo]))+ | [-+=][0-7]+
//
// - A clause with no u, g, o or a applies to everyone, less the bits in the umask: with the usual
//   022, `chmod +w` gives write to the owner only.
// - X adds execute only to folders and to files someone may already execute.
// - u, g or o after the operator copies that class's bits: `g=u`.
// - A folder keeps its set-user-ID and set-group-ID bits unless the mode names them, or is an
//   octal number of five digits or more (`00755`).
// lib/mode.ts is the smaller reader mkdir -m uses; this one is the whole grammar.

const SUID = 0o4000;
const SGID = 0o2000;
const STICKY = 0o1000;
/** Every bit chmod may change. */
const ALL = 0o7777;
const READ = 0o444;
const WRITE = 0o222;
const EXEC = 0o111;

const WHO: Readonly<Record<string, number>> = { u: SUID | 0o700, g: SGID | 0o070, o: STICKY | 0o007, a: ALL };
const CLASS: Readonly<Record<string, number>> = { u: 0o700, g: 0o070, o: 0o007 };

interface Change {
  readonly op: '=' | '+' | '-';
  /** `copy` for [ugo] after the operator, `x-if-any` for X. */
  readonly flag: 'ordinary' | 'copy' | 'x-if-any';
  /** The bits the who letters cover; 0 when there were none, so the umask applies. */
  readonly affected: number;
  readonly value: number;
  /** The bits the mode names, which a folder's setuid and setgid bits need to be changed. */
  readonly mentioned: number;
}

/** A mode read once, to apply to each file. */
export interface CompiledMode {
  readonly changes: readonly Change[];
  /** True when a clause names nobody, so the umask decides what it changes. */
  readonly usesUmask: boolean;
}

function octal(text: string): CompiledMode | null {
  const value = parseInt(text, 8);
  if (value > ALL) return null;
  // Fewer than five digits leave a folder's setuid and setgid bits alone unless they are set.
  const mentioned = text.length >= 5 ? ALL : 0o777 | STICKY | (value & (SUID | SGID));
  return { changes: [{ op: '=', flag: 'ordinary', affected: ALL, value, mentioned }], usesUmask: false };
}

/** Reads a mode; null when it is not one, for "invalid mode". */
export function compileMode(text: string): CompiledMode | null {
  if (/^[0-7]+$/.test(text)) return octal(text);
  const changes: Change[] = [];
  let usesUmask = false;
  for (const clause of text.split(',')) {
    let i = 0;
    let affected = 0;
    while (i < clause.length && WHO[clause.charAt(i)] !== undefined) {
      affected |= WHO[clause.charAt(i)] ?? 0;
      i += 1;
    }
    if (i >= clause.length) return null;
    while (i < clause.length) {
      const op = clause.charAt(i);
      if (op !== '=' && op !== '+' && op !== '-') return null;
      i += 1;
      let value = 0;
      let flag: Change['flag'] = 'ordinary';
      let clauseAffected = affected;
      const c = clause.charAt(i);
      if (/[0-7]/.test(c)) {
        if (affected !== 0) return null;
        const digits = /^[0-7]+/.exec(clause.slice(i))?.[0] ?? '';
        value = parseInt(digits, 8);
        if (value > ALL) return null;
        i += digits.length;
        clauseAffected = ALL;
      } else if (CLASS[c] !== undefined) {
        flag = 'copy';
        value = CLASS[c] ?? 0;
        i += 1;
      } else {
        while (i < clause.length && 'rwxXst'.includes(clause.charAt(i))) {
          const perm = clause.charAt(i);
          if (perm === 'r') value |= READ;
          else if (perm === 'w') value |= WRITE;
          else if (perm === 'x') value |= EXEC;
          else if (perm === 'X') flag = 'x-if-any';
          else if (perm === 's') value |= SUID | SGID;
          else value |= STICKY;
          i += 1;
        }
      }
      if (clauseAffected === 0) usesUmask = true;
      const mentioned = clauseAffected !== 0 ? clauseAffected & value : value;
      changes.push({ op, flag, affected: clauseAffected, value, mentioned });
    }
  }
  return { changes, usesUmask };
}

/** The mode `mode` gives a file whose mode is now `old`, under `umask`. */
export function applyMode(mode: CompiledMode, old: number, directory: boolean, umask: number): number {
  let next = old & ALL;
  for (const change of mode.changes) {
    const omit = (directory ? SUID | SGID : 0) & ~change.mentioned;
    let value = change.value;
    if (change.flag === 'copy') {
      value &= next;
      value |= (value & READ ? READ : 0) | (value & WRITE ? WRITE : 0) | (value & EXEC ? EXEC : 0);
    } else if (change.flag === 'x-if-any' && ((next & EXEC) !== 0 || directory)) {
      value |= EXEC;
    }
    value &= (change.affected !== 0 ? change.affected : ~umask) & ~omit;
    if (change.op === '=') {
      const preserved = (change.affected !== 0 ? ~change.affected : 0) | omit;
      next = (next & preserved) | value;
    } else if (change.op === '+') {
      next |= value;
    } else {
      next &= ~value;
    }
  }
  return next & ALL;
}

/** `rw-r--r--`: the nine permission letters of `ls -l`, with s, S, t and T. */
export function permString(mode: number): string {
  const triple = (shift: number, special: number, lower: string, upper: string): string => {
    const bits = (mode >> shift) & 7;
    const x = (bits & 1) !== 0;
    const s = (mode & special) !== 0;
    return (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (s ? (x ? lower : upper) : x ? 'x' : '-');
  };
  return triple(6, SUID, 's', 'S') + triple(3, SGID, 's', 'S') + triple(0, STICKY, 't', 'T');
}

/** `0644 (rw-r--r--)`, as chmod -v describes a mode. */
export function describeMode(mode: number): string {
  return `${(mode & ALL).toString(8).padStart(4, '0')} (${permString(mode)})`;
}
