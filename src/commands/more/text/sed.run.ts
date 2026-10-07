// The body of sed; its spec, in sed.ts, loads this the first time sed runs. The script is parsed
// into a flat list of commands, with blocks and labels as jumps, and run once per input line as
// GNU sed runs it. Regular expressions go through the shared guard (commands/lib/regex.ts).

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { reason } from '../../lib/files';
import { compilePatterns, patternMessage, type SafeRegex } from '../../lib/regex';
import { inputRecords, optList, optOn, pacer, splitRecords, type Rec } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    "Reads each FILE, or standard input, a line at a time into the pattern space, runs the script on it, and prints the pattern space unless -n is given. The script is the first operand, or the -e and -f scripts. Commands are separated by ; or new lines, and each may have an address: a line number, $ for the last line, /regexp/ (I to ignore case), first~step, or a range addr1,addr2 (addr2 may be +N or ~N, and 0,/regexp/ may end on the first line); ! after the address selects the other lines. With -i, each FILE is rewritten with the output instead.",
  man: [
    {
      heading: 'COMMANDS',
      body: 's/regexp/replacement/flags substitute, with & for the match and \\1 to \\9 for groups, \\n for a new line, and \\U \\L \\u \\l \\E to change case; flags g (every match), N (the Nth), p (print), I (ignore case), M (multi-line), w FILE. y/abc/xyz/ transliterate. p print, P print the first line, d delete, D delete the first line, = print the line number, l print unambiguously, a text append, i text insert, c text change, n and N read the next line, g G h H x the hold space, b t T jumps to :labels, q and Q quit with an optional status, r FILE and w FILE read and write files, F print the file name, z empty the pattern space, { } group, # comment.',
    },
    {
      heading: 'LIMITS',
      body: 'Regular expressions are refused when they could run for ever, as grep refuses them, and a pattern space longer than the pattern allows is an error. The pattern space and hold space may hold up to a million characters.',
    },
    { heading: 'EXIT STATUS', body: '0 on success, 1 for an invalid script, 2 when an input file cannot be read, 4 for an I/O error; q and Q may set their own.' },
  ],
};

/** The pattern and hold space limit, in characters. */
const MAX_SPACE = 1_000_000;

class ScriptError extends Error {}

// ── The script ─────────────────────────────────────────────────────────────────────────────

/** A regular expression in the script; null source means the last one used. */
interface Rx {
  readonly safe: SafeRegex | null;
}

type Addr =
  | { readonly t: 'line'; readonly n: number }
  | { readonly t: 'last' }
  | { readonly t: 'rx'; readonly rx: Rx }
  | { readonly t: 'step'; readonly first: number; readonly step: number }
  | { readonly t: 'plus'; readonly n: number }
  | { readonly t: 'mult'; readonly n: number }
  | { readonly t: 'zero' };

type Piece = { readonly t: 'text'; readonly s: string } | { readonly t: 'group'; readonly n: number } | { readonly t: 'case'; readonly c: 'U' | 'L' | 'u' | 'l' | 'E' };

interface Cmd {
  readonly name: string;
  readonly a1: Addr | null;
  readonly a2: Addr | null;
  readonly negate: boolean;
  /** Text for a, i, c; a label for b, t, T, :; a file for r, w. */
  text?: string;
  /** For { the index of its }; for b, t, T the index to jump to. */
  jump?: number;
  /** q and Q: the exit status. */
  code?: number;
  /** s: */
  rx?: Rx;
  replacement?: Piece[];
  global?: boolean;
  nth?: number;
  print?: boolean;
  writeTo?: string;
  /** y: */
  map?: Map<string, string>;
  /** A range in progress, and where it ends when it ends on a line number. */
  active?: boolean;
  endLine?: number;
}

interface Script {
  readonly cmds: Cmd[];
  readonly quiet: boolean;
}

/** Where a position in the joined script is: `-e expression #2, char 7`. */
type Locate = (at: number) => string;

class Parser {
  i = 0;
  readonly cmds: Cmd[] = [];
  private readonly blocks: number[] = [];

  constructor(
    private readonly s: string,
    private readonly extended: boolean,
    private readonly locate: Locate,
  ) {}

  fail(message: string, at = this.i): never {
    throw new ScriptError(`${this.locate(at)}: ${message}`);
  }

  private peek(): string {
    return this.s.charAt(this.i);
  }

  private skipSpace(): void {
    while (this.i < this.s.length && /[ \t]/.test(this.peek())) this.i += 1;
  }

  private number(): number | null {
    const match = /^\d+/.exec(this.s.slice(this.i));
    if (match === null) return null;
    this.i += match[0].length;
    return Number(match[0]);
  }

  /** Reads up to the unescaped delimiter; `\delim` becomes the delimiter itself. */
  private delimited(delim: string, what: string, regex: boolean): string {
    let text = '';
    while (this.i < this.s.length) {
      const c = this.peek();
      if (c === '\\') {
        const d = this.s.charAt(this.i + 1);
        if (d === delim) {
          // An escaped delimiter is the character itself, even one that is special in a pattern.
          text += !regex ? d : /[.*$+?(){}|[]/.test(d) ? `[${d}]` : d === '^' || d === ']' ? `\\${d}` : d;
        } else if (d === '\n') {
          text += regex ? '\\n' : '\n';
        } else {
          text += `\\${d}`;
        }
        this.i += 2;
        continue;
      }
      if (c === delim) {
        this.i += 1;
        return text;
      }
      // An unescaped new line ends the command early.
      if (c === '\n') break;
      text += c;
      this.i += 1;
    }
    return this.fail(what);
  }

  private regex(source: string, flags: string): Rx {
    if (source === '') return { safe: null };
    try {
      return {
        safe: compilePatterns([source], {
          syntax: this.extended ? 'extended' : 'basic',
          sed: true,
          ignoreCase: flags.includes('I'),
          flags: `g${flags.includes('M') ? 'm' : ''}`,
        }),
      };
    } catch (error) {
      const message = patternMessage(error);
      if (message === null) throw error;
      return this.fail(message);
    }
  }

  private address(): Addr | null {
    const c = this.peek();
    if (c === '$') {
      this.i += 1;
      return { t: 'last' };
    }
    if (c === '/' || c === '\\') {
      let delim = '/';
      if (c === '\\') {
        delim = this.s.charAt(this.i + 1);
        this.i += 1;
      }
      this.i += 1;
      const source = this.delimited(delim, 'unterminated address regex', true);
      let flags = '';
      while (/[IM]/.test(this.peek())) {
        flags += this.peek();
        this.i += 1;
      }
      return { t: 'rx', rx: this.regex(source, flags) };
    }
    const n = this.number();
    if (n === null) return null;
    if (this.peek() === '~') {
      this.i += 1;
      const step = this.number() ?? 0;
      return { t: 'step', first: n, step };
    }
    return n === 0 ? { t: 'zero' } : { t: 'line', n };
  }

  private secondAddress(): Addr {
    const c = this.peek();
    if (c === '+' || c === '~') {
      this.i += 1;
      const n = this.number();
      if (n === null) this.fail('expected newer version of sed');
      return c === '+' ? { t: 'plus', n } : { t: 'mult', n };
    }
    const addr = this.address();
    if (addr === null) return this.fail('unexpected `,\'');
    if (addr.t === 'zero') return this.fail('invalid usage of line address 0');
    return addr;
  }

  /** The rest of the line, for a, i and c: `a text` or `a\` and a new line. */
  private textArgument(): string {
    this.skipSpace();
    if (this.peek() === '\\') {
      this.i += 1;
      if (this.peek() === '\n') this.i += 1;
    }
    let text = '';
    while (this.i < this.s.length && this.peek() !== '\n') {
      const c = this.peek();
      if (c === '\\') {
        const d = this.s.charAt(this.i + 1);
        text += d === '\n' ? '\n' : d === 't' ? '\t' : d;
        this.i += 2;
        continue;
      }
      text += c;
      this.i += 1;
    }
    return text;
  }

  private label(): string {
    this.skipSpace();
    let text = '';
    while (this.i < this.s.length && !/[;\n]/.test(this.peek())) {
      text += this.peek();
      this.i += 1;
    }
    return text.trim();
  }

  private fileName(): string {
    this.skipSpace();
    let text = '';
    while (this.i < this.s.length && this.peek() !== '\n') {
      text += this.peek();
      this.i += 1;
    }
    return text;
  }

  private replacement(text: string, groups: number): Piece[] {
    const pieces: Piece[] = [];
    let literal = '';
    const flush = (): void => {
      if (literal !== '') pieces.push({ t: 'text', s: literal });
      literal = '';
    };
    for (let k = 0; k < text.length; k += 1) {
      const c = text.charAt(k);
      if (c === '&') {
        flush();
        pieces.push({ t: 'group', n: 0 });
        continue;
      }
      if (c !== '\\') {
        literal += c;
        continue;
      }
      k += 1;
      const d = text.charAt(k);
      if (/[0-9]/.test(d)) {
        const n = Number(d);
        if (n > groups) this.fail(`invalid reference \\${n} on \`s' command's RHS`);
        flush();
        pieces.push({ t: 'group', n });
      } else if (d === 'U' || d === 'L' || d === 'u' || d === 'l' || d === 'E') {
        flush();
        pieces.push({ t: 'case', c: d });
      } else {
        literal += d === 'n' ? '\n' : d === 't' ? '\t' : d === 'r' ? '\r' : d === 'a' ? '\x07' : d === 'f' ? '\f' : d === 'v' ? '\v' : d;
      }
    }
    flush();
    return pieces;
  }

  /** After a command: blanks, then ; or a new line or } or the end. */
  private end(): void {
    this.skipSpace();
    const c = this.peek();
    if (c === ';' || c === '\n') this.i += 1;
    else if (c !== '}' && c !== '#' && this.i < this.s.length) this.fail('extra characters after command');
  }

  parse(): Cmd[] {
    const { s } = this;
    while (this.i < s.length) {
      const c = this.peek();
      if (/[\s;]/.test(c)) {
        this.i += 1;
        continue;
      }
      if (c === '#') {
        while (this.i < s.length && this.peek() !== '\n') this.i += 1;
        continue;
      }
      const a1 = this.address();
      let a2: Addr | null = null;
      if (a1 !== null) {
        this.skipSpace();
        if (this.peek() === ',') {
          this.i += 1;
          this.skipSpace();
          a2 = this.secondAddress();
        }
        if (a1.t === 'zero' && (a2 === null || a2.t !== 'rx')) this.fail('invalid usage of line address 0');
      }
      this.skipSpace();
      let negate = false;
      while (this.peek() === '!') {
        negate = true;
        this.i += 1;
        this.skipSpace();
      }
      if (this.i >= s.length) this.fail('missing command');
      const at = this.i;
      const name = this.peek();
      this.i += 1;
      const cmd: Cmd = { name, a1, a2, negate };
      const oneAddress = (): void => {
        if (a2 !== null) this.fail('command only uses one address', at);
      };
      const noAddress = (): void => {
        if (a1 !== null) this.fail(`${name === '}' ? 'unexpected `}\'' : `${name} doesn't want any addresses`}`, at);
      };
      switch (name) {
        case '{':
          this.blocks.push(this.cmds.length);
          this.cmds.push(cmd);
          continue;
        case '}': {
          noAddress();
          const open = this.blocks.pop();
          if (open === undefined) this.fail('unexpected `}\'', at);
          (this.cmds[open] as Cmd).jump = this.cmds.length + 1;
          this.cmds.push(cmd);
          this.end();
          continue;
        }
        case '=':
        case 'd':
        case 'D':
        case 'g':
        case 'G':
        case 'h':
        case 'H':
        case 'x':
        case 'n':
        case 'N':
        case 'p':
        case 'P':
        case 'z':
        case 'F':
        case 'l':
          if (name === 'l') this.number();
          this.end();
          break;
        case 'q':
        case 'Q':
          oneAddress();
          this.skipSpace();
          cmd.code = this.number() ?? 0;
          this.end();
          break;
        case 'a':
        case 'i':
        case 'c':
          cmd.text = this.textArgument();
          break;
        case ':':
          noAddress();
          cmd.text = this.label();
          if (cmd.text === '') this.fail('":" lacks a label', at);
          if (this.peek() === ';') this.i += 1;
          break;
        case 'b':
        case 't':
        case 'T':
          cmd.text = this.label();
          if (this.peek() === ';') this.i += 1;
          break;
        case 'r':
        case 'w':
          cmd.text = this.fileName();
          break;
        case 's': {
          const delim = this.peek();
          if (delim === '' || delim === '\n' || delim === '\\') this.fail("unterminated `s' command");
          this.i += 1;
          const source = this.delimited(delim, "unterminated `s' command", true);
          const replacement = this.delimited(delim, "unterminated `s' command", false);
          let flags = '';
          let nth: number | null = null;
          for (;;) {
            const f = this.peek();
            if (f === 'g' || f === 'p' || f === 'i' || f === 'I' || f === 'm' || f === 'M' || f === 'e') {
              if ((f === 'g' || f === 'p') && flags.includes(f)) this.fail(`multiple \`${f}' options to \`s' command`);
              if (f === 'e') this.fail("unknown option to `s'");
              flags += f;
              this.i += 1;
            } else if (/\d/.test(f)) {
              if (nth !== null) this.fail("multiple number options to `s' command");
              nth = this.number() ?? 1;
              if (nth === 0) this.fail("number option to `s' command may not be zero");
            } else if (f === 'w') {
              this.i += 1;
              cmd.writeTo = this.fileName();
              break;
            } else {
              if (f !== '' && !/[\s;}#]/.test(f)) this.fail("unknown option to `s'", this.i);
              break;
            }
          }
          const rxFlags = (flags.includes('i') || flags.includes('I') ? 'I' : '') + (flags.includes('m') || flags.includes('M') ? 'M' : '');
          cmd.rx = this.regex(source, rxFlags);
          const groups = cmd.rx.safe === null ? 9 : cmd.rx.safe.groups;
          cmd.replacement = this.replacement(replacement, groups);
          cmd.global = flags.includes('g');
          cmd.print = flags.includes('p');
          cmd.nth = nth ?? 1;
          if (cmd.writeTo === undefined) this.end();
          break;
        }
        case 'y': {
          const delim = this.peek();
          this.i += 1;
          const from = Array.from(unescapeY(this.delimited(delim, "unterminated `y' command", false)));
          const to = Array.from(unescapeY(this.delimited(delim, "unterminated `y' command", false)));
          if (from.length !== to.length) this.fail("strings for `y' command are different lengths");
          cmd.map = new Map(from.map((ch, k) => [ch, to[k] ?? ch]));
          this.end();
          break;
        }
        case 'e':
        case 'R':
        case 'W':
        case 'v':
          this.fail(`unknown command: \`${name}'`, at);
          break;
        default:
          this.fail(`unknown command: \`${name}'`, at);
      }
      this.cmds.push(cmd);
    }
    if (this.blocks.length > 0) throw new ScriptError(`${this.locate(-1)}: unmatched \`{'`);
    // Jumps: to a label, or to the end of the script.
    const labels = new Map<string, number>();
    this.cmds.forEach((cmd, k) => {
      if (cmd.name === ':' && cmd.text !== undefined) labels.set(cmd.text, k);
    });
    for (const cmd of this.cmds) {
      if (cmd.name !== 'b' && cmd.name !== 't' && cmd.name !== 'T') continue;
      if (cmd.text === undefined || cmd.text === '') {
        cmd.jump = this.cmds.length;
        continue;
      }
      const target = labels.get(cmd.text);
      if (target === undefined) throw new ScriptError(`can't find label for jump to \`${cmd.text}'`);
      cmd.jump = target;
    }
    return this.cmds;
  }
}

function unescapeY(text: string): string {
  return text.replace(/\\(.)/gs, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === '\\' ? '\\' : c));
}

// ── Running ────────────────────────────────────────────────────────────────────────────────

/** The input: every file's lines in turn, read one ahead so `$` is known. */
class Input {
  private queue: { name: string; records: AsyncIterator<Rec> | null }[];
  private current: { name: string; records: AsyncIterator<Rec> } | null = null;
  private ahead: { rec: Rec; name: string } | null | undefined = undefined;
  line = 0;
  name = '-';
  /** The last line read lacked a newline. */
  missingNewline = false;

  constructor(
    private readonly ctx: CommandContext,
    files: readonly string[],
    private readonly onError: (file: string, why: string) => Promise<void>,
  ) {
    this.queue = files.map((name) => ({ name, records: null }));
  }

  private async pull(): Promise<{ rec: Rec; name: string } | null> {
    for (;;) {
      if (this.current === null) {
        const next = this.queue.shift();
        if (next === undefined) return null;
        const records = await this.open(next.name);
        if (records === null) continue;
        this.current = { name: next.name, records };
      }
      const step = await this.current.records.next();
      if (!step.done) return { rec: step.value, name: this.current.name };
      this.current = null;
    }
  }

  private async open(name: string): Promise<AsyncIterator<Rec> | null> {
    if (name === '-') return inputRecords(this.ctx)[Symbol.asyncIterator]();
    try {
      const text = this.ctx.fs.readFile(this.ctx.resolve(name));
      const records = splitRecords(text);
      return (async function* () {
        yield* records;
      })();
    } catch (error) {
      await this.onError(name, reason(error));
      return null;
    }
  }

  async next(): Promise<Rec | null> {
    const got = this.ahead === undefined ? await this.pull() : this.ahead;
    this.ahead = undefined;
    if (got === null) return null;
    this.line += 1;
    this.name = got.name;
    this.missingNewline = !got.rec.nl;
    return got.rec;
  }

  async isLast(): Promise<boolean> {
    if (this.ahead === undefined) this.ahead = await this.pull();
    return this.ahead === null;
  }
}

interface Run {
  readonly ctx: CommandContext;
  readonly script: Script;
  readonly input: Input;
  out: string[];
  /** The previous output lacked its newline, which goes before anything more. */
  pendingNewline: boolean;
  lastRx: SafeRegex | null;
  hold: string;
  /** Files written with w, emptied when first written. */
  written: Set<string>;
  /** sed exits with this, after q or Q. */
  quit: number | null;
}

function write(run: Run, text: string, newline = true): void {
  if (run.pendingNewline) run.out.push('\n');
  run.out.push(text);
  if (newline) run.out.push('\n');
  run.pendingNewline = false;
}

/** Writes the pattern space, without its newline when the input line had none. */
function writeSpace(run: Run, text: string): void {
  write(run, text, !run.input.missingNewline);
  if (run.input.missingNewline) run.pendingNewline = true;
}

function useRx(run: Run, rx: Rx): SafeRegex {
  const safe = rx.safe ?? run.lastRx;
  if (safe === null) throw new ScriptError('no previous regular expression');
  run.lastRx = safe;
  return safe;
}

function testRx(run: Run, rx: Rx, text: string): boolean {
  const safe = useRx(run, rx);
  safe.check(text);
  safe.regex.lastIndex = 0;
  return safe.regex.test(text);
}

async function matchAddr(run: Run, addr: Addr, space: string): Promise<boolean> {
  const line = run.input.line;
  switch (addr.t) {
    case 'line':
      return line === addr.n;
    case 'last':
      return run.input.isLast();
    case 'rx':
      return testRx(run, addr.rx, space);
    case 'step':
      return addr.step <= 0 ? line === addr.first : line >= addr.first && (line - addr.first) % addr.step === 0;
    case 'zero':
      return false;
    default:
      return false;
  }
}

/** Whether a command applies to this line, moving its range along. */
async function selects(run: Run, cmd: Cmd, space: string): Promise<boolean> {
  const { a1, a2 } = cmd;
  if (a1 === null) return !cmd.negate;
  if (a2 === null) return (await matchAddr(run, a1, space)) !== cmd.negate;
  const line = run.input.line;
  let hit: boolean;
  if (!cmd.active) {
    const starts = a1.t === 'zero' ? line === 1 || false : await matchAddr(run, a1, space);
    if (a1.t === 'zero') {
      // 0,/re/: in the range from the start; it may end on line 1.
      if (cmd.endLine === undefined) {
        cmd.active = true;
        cmd.endLine = -1;
        hit = true;
        if (a2.t === 'rx' && testRx(run, a2.rx, space)) cmd.active = false;
        return hit !== cmd.negate;
      }
      return cmd.negate;
    }
    if (!starts) return cmd.negate;
    hit = true;
    cmd.active = true;
    if (a2.t === 'line') {
      if (a2.n <= line) cmd.active = false;
    } else if (a2.t === 'plus') {
      cmd.endLine = line + a2.n;
      if (a2.n === 0) cmd.active = false;
    } else if (a2.t === 'mult') {
      if (a2.n <= 0 || line % a2.n === 0) cmd.active = false;
    } else if (a2.t === 'last') {
      if (await run.input.isLast()) cmd.active = false;
    }
    return hit !== cmd.negate;
  }
  // Inside the range: does this line end it?
  switch (a2.t) {
    case 'line':
      if (line >= a2.n) cmd.active = false;
      if (line > a2.n) return cmd.negate;
      break;
    case 'plus':
      if (line >= (cmd.endLine ?? line)) cmd.active = false;
      break;
    case 'mult':
      if (a2.n <= 0 || line % a2.n === 0) cmd.active = false;
      break;
    case 'last':
      if (await run.input.isLast()) cmd.active = false;
      break;
    case 'rx':
      if (testRx(run, a2.rx, space)) cmd.active = false;
      break;
    default:
      cmd.active = false;
  }
  return !cmd.negate;
}

function applyCase(text: string, mode: { all: 'U' | 'L' | null; next: 'u' | 'l' | null }): string {
  let out = mode.all === 'U' ? text.toUpperCase() : mode.all === 'L' ? text.toLowerCase() : text;
  if (mode.next !== null && out !== '') {
    const first = String.fromCodePoint(out.codePointAt(0) ?? 0);
    out = (mode.next === 'u' ? first.toUpperCase() : first.toLowerCase()) + out.slice(first.length);
    mode.next = null;
  }
  return out;
}

function expandReplacement(pieces: readonly Piece[], m: RegExpExecArray): string {
  const mode: { all: 'U' | 'L' | null; next: 'u' | 'l' | null } = { all: null, next: null };
  let out = '';
  for (const piece of pieces) {
    if (piece.t === 'case') {
      if (piece.c === 'U' || piece.c === 'L') mode.all = piece.c;
      else if (piece.c === 'E') mode.all = null;
      else mode.next = piece.c;
      continue;
    }
    out += applyCase(piece.t === 'text' ? piece.s : (m[piece.n] ?? ''), mode);
  }
  return out;
}

/** s///: the new pattern space, or null when nothing was replaced. */
function substitute(run: Run, cmd: Cmd, space: string): string | null {
  const safe = useRx(run, cmd.rx as Rx);
  safe.check(space);
  const re = safe.regex;
  re.lastIndex = 0;
  let out = '';
  let pos = 0;
  let count = 0;
  let replaced = false;
  let prevEnd = -1;
  while (re.lastIndex <= space.length) {
    const m = re.exec(space);
    if (m === null) break;
    const start = m.index;
    const end = start + m[0].length;
    const step = (space.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
    // An empty match just after the previous match does not count, as in GNU sed.
    if (start === end && start === prevEnd) {
      re.lastIndex = end + step;
      continue;
    }
    count += 1;
    prevEnd = end;
    if (count >= (cmd.nth ?? 1) && (cmd.global || count === (cmd.nth ?? 1))) {
      out += space.slice(pos, start) + expandReplacement(cmd.replacement ?? [], m);
      pos = end;
      replaced = true;
      if (!cmd.global) break;
    }
    re.lastIndex = start === end ? end + step : end;
  }
  if (!replaced) return null;
  const result = out + space.slice(pos);
  if (result.length > MAX_SPACE) throw new ScriptError(`pattern space too long (over ${MAX_SPACE} characters)`);
  return result;
}

/** l: the pattern space with escapes, broken into lines of 69 characters and a backslash. */
function unambiguous(text: string): string {
  const named: Record<string, string> = { '\\': '\\\\', '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v' };
  let line = '';
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const piece = named[ch] ?? (code < 0x20 || code === 0x7f ? `\\${code.toString(8).padStart(3, '0')}` : ch);
    if (line.length + piece.length > 69) {
      out += `${line}\\\n`;
      line = '';
    }
    line += piece;
  }
  return `${out}${line}$`;
}

function writeFile(run: Run, name: string, text: string): void {
  const { ctx } = run;
  if (name === '/dev/stdout') {
    write(run, text);
    return;
  }
  const first = !run.written.has(name);
  run.written.add(name);
  try {
    ctx.fs.writeFile(ctx.resolve(name), `${text}\n`, { append: !first });
  } catch (error) {
    throw new ScriptError(`couldn't open file ${name}: ${reason(error)}`);
  }
}

/** Runs the script over the whole input. */
async function execute(run: Run): Promise<void> {
  const { script, input, ctx } = run;
  const { cmds } = script;
  const breathe = pacer(ctx);
  let carry: string | null = null;
  for (;;) {
    let space: string;
    if (carry !== null) {
      space = carry;
      carry = null;
    } else {
      const rec = await input.next();
      if (rec === null) return;
      space = rec.text;
    }
    const appended: string[] = [];
    let flag = false;
    let autoprint = !script.quiet;
    let restart = false;
    let pc = 0;
    cycle: while (pc < cmds.length) {
      const cmd = cmds[pc] as Cmd;
      if (cmd.name === ':' || cmd.name === '}') {
        pc += 1;
        continue;
      }
      if (!(await selects(run, cmd, space))) {
        pc = cmd.name === '{' ? (cmd.jump ?? pc + 1) : pc + 1;
        continue;
      }
      pc += 1;
      switch (cmd.name) {
        case '{':
          break;
        case '=':
          write(run, String(input.line));
          break;
        case 'a':
          appended.push(`${cmd.text ?? ''}\n`);
          break;
        case 'i':
          write(run, cmd.text ?? '');
          break;
        case 'c':
          // In a range, the text replaces the whole range, so it is printed at its end.
          if (cmd.a2 === null || !cmd.active) write(run, cmd.text ?? '');
          autoprint = false;
          break cycle;
        case 'd':
          autoprint = false;
          break cycle;
        case 'D': {
          const newline = space.indexOf('\n');
          autoprint = false;
          if (newline !== -1) {
            carry = space.slice(newline + 1);
            restart = true;
          }
          break cycle;
        }
        case 'g':
          space = run.hold;
          break;
        case 'G':
          space = `${space}\n${run.hold}`;
          break;
        case 'h':
          run.hold = space;
          break;
        case 'H':
          run.hold = `${run.hold}\n${space}`;
          break;
        case 'x':
          [space, run.hold] = [run.hold, space];
          break;
        case 'l':
          write(run, unambiguous(space));
          break;
        case 'n': {
          if (await input.isLast()) {
            // No next line: GNU sed prints the pattern space and stops.
            break cycle;
          }
          if (!script.quiet) writeSpace(run, space);
          const rec = await input.next();
          space = rec?.text ?? '';
          break;
        }
        case 'N': {
          if (await input.isLast()) break cycle;
          const rec = await input.next();
          space = `${space}\n${rec?.text ?? ''}`;
          break;
        }
        case 'p':
          writeSpace(run, space);
          break;
        case 'P': {
          const newline = space.indexOf('\n');
          write(run, newline === -1 ? space : space.slice(0, newline));
          break;
        }
        case 'q':
          run.quit = cmd.code ?? 0;
          break cycle;
        case 'Q':
          run.quit = cmd.code ?? 0;
          autoprint = false;
          appended.length = 0;
          break cycle;
        case 's': {
          const result = substitute(run, cmd, space);
          if (result !== null) {
            space = result;
            flag = true;
            if (cmd.print) writeSpace(run, space);
            if (cmd.writeTo !== undefined) writeFile(run, cmd.writeTo, space);
          }
          break;
        }
        case 'y':
          space = Array.from(space, (ch) => cmd.map?.get(ch) ?? ch).join('');
          break;
        case 'b':
          pc = cmd.jump ?? cmds.length;
          break;
        case 't':
          if (flag) {
            flag = false;
            pc = cmd.jump ?? cmds.length;
          }
          break;
        case 'T':
          if (!flag) pc = cmd.jump ?? cmds.length;
          else flag = false;
          break;
        case 'z':
          space = '';
          break;
        case 'F':
          write(run, input.name);
          break;
        case 'r':
          try {
            const text = ctx.fs.readFile(ctx.resolve(cmd.text ?? ''));
            if (text !== '') appended.push(text.endsWith('\n') ? text : `${text}\n`);
          } catch {
            // A file that cannot be read is skipped quietly, as in GNU sed.
          }
          break;
        case 'w':
          writeFile(run, cmd.text ?? '', space);
          break;
        default:
          break;
      }
      if (space.length > MAX_SPACE || run.hold.length > MAX_SPACE) throw new ScriptError(`pattern space too long (over ${MAX_SPACE} characters)`);
    }
    if (autoprint) writeSpace(run, space);
    for (const text of appended) write(run, text, false);
    if (run.out.length > 256) {
      await ctx.stdout.write(run.out.join(''));
      run.out = [];
    }
    await breathe();
    if (run.quit !== null) return;
    if (restart) continue;
  }
}

/** The joined script and a way to say where a position in it came from. */
async function readScript(ctx: CommandContext): Promise<{ text: string; locate: Locate; files: string[] } | { status: ExitCode }> {
  const expressions = optList(ctx, 'expression');
  const scriptFiles = optList(ctx, 'file');
  const parts: { text: string; label: (char: number) => string }[] = [];
  let files = [...ctx.args];
  if (expressions.length === 0 && scriptFiles.length === 0) {
    const [first, ...rest] = files;
    if (first === undefined) {
      await ctx.stderr.write('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n');
      return { status: await ctx.usage() };
    }
    parts.push({ text: first, label: (char) => `-e expression #1, char ${char}` });
    files = rest;
  } else {
    expressions.forEach((text, k) => parts.push({ text, label: (char) => `-e expression #${k + 1}, char ${char}` }));
    for (const file of scriptFiles) {
      try {
        const text = ctx.fs.readFile(ctx.resolve(file)).replace(/\n$/, '');
        parts.push({ text, label: (char) => `file ${file} line ${text.slice(0, Math.max(0, char - 1)).split('\n').length}` });
      } catch (error) {
        return { status: await ctx.fail(`couldn't open file ${file}: ${reason(error)}`) };
      }
    }
  }
  const starts: number[] = [];
  let text = '';
  for (const part of parts) {
    starts.push(text.length);
    text += `${part.text}\n`;
  }
  const locate: Locate = (at) => {
    if (at < 0) {
      const last = parts[parts.length - 1];
      return last === undefined ? '-e expression #1, char 0' : last.label(0);
    }
    let k = starts.length - 1;
    while (k > 0 && (starts[k] ?? 0) > at) k -= 1;
    const part = parts[k] as (typeof parts)[number];
    // GNU counts the characters read, so an error at the end of an expression is at its length.
    const offset = at - (starts[k] ?? 0);
    return part.label(offset >= part.text.length ? part.text.length : offset + 1);
  };
  return { text, locate, files };
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const read = await readScript(ctx);
  if ('status' in read) return read.status;
  let cmds: Cmd[];
  try {
    cmds = new Parser(read.text, ctx.opts.extended === true, read.locate).parse();
  } catch (error) {
    if (error instanceof ScriptError) return ctx.fail(error.message);
    throw error;
  }
  const quiet = optOn(ctx, 'quiet') || read.text.startsWith('#n\n');
  const script: Script = { cmds, quiet };
  const inPlace = ctx.opts['in-place'];
  const separate = inPlace !== undefined || optOn(ctx, 'separate');
  let status = 0;
  const onError = async (file: string, why: string): Promise<void> => {
    status = 2;
    await ctx.fail(`can't read ${file}: ${why}`, 2);
  };

  // The hold space and the files w writes last across files read separately.
  let hold = '';
  const written = new Set<string>();
  const go = async (files: readonly string[], target: string | null): Promise<number | null> => {
    const run: Run = {
      ctx,
      script,
      input: new Input(ctx, files, onError),
      out: [],
      pendingNewline: false,
      lastRx: null,
      hold,
      written,
      quit: null,
    };
    try {
      await execute(run);
      hold = run.hold;
    } catch (error) {
      const message = error instanceof ScriptError ? error.message : patternMessage(error);
      if (message === null) throw error;
      if (target === null) await ctx.stdout.write(run.out.join(''));
      await ctx.fail(message, 4);
      return 4;
    }
    const text = run.out.join('');
    if (target === null) {
      if (text !== '') await ctx.stdout.write(text);
    } else {
      try {
        ctx.fs.writeFile(target, text);
      } catch (error) {
        await ctx.fail(`couldn't open temporary file ${target}: ${reason(error)}`, 4);
        return 4;
      }
    }
    return run.quit;
  };

  const files = read.files.length === 0 ? ['-'] : read.files;
  if (inPlace !== undefined) {
    if (read.files.length === 0) return ctx.fail('no input files', 1);
    const suffix = typeof inPlace === 'string' ? inPlace : '';
    for (const file of files) {
      const path = ctx.resolve(file);
      let stat;
      try {
        stat = ctx.fs.stat(path);
      } catch (error) {
        await onError(file, reason(error));
        continue;
      }
      if (stat.type !== 'file') {
        status = 4;
        await ctx.fail(`couldn't edit ${file}: not a regular file`, 4);
        continue;
      }
      if (suffix !== '') {
        const base = file.slice(file.lastIndexOf('/') + 1);
        const backup = suffix.includes('*') ? suffix.replace(/\*/g, base) : `${file}${suffix}`;
        try {
          ctx.fs.writeFile(ctx.resolve(backup.includes('/') || !suffix.includes('*') ? backup : file.slice(0, file.length - base.length) + backup), ctx.fs.readFile(path));
        } catch (error) {
          await ctx.fail(`cannot rename ${file}: ${reason(error)}`, 4);
          status = 4;
          continue;
        }
      }
      const quit = await go([file], path);
      if (quit === 4) status = 4;
      else if (quit !== null) return quit;
    }
    return status;
  }
  if (separate) {
    for (const file of files) {
      const quit = await go([file], null);
      if (quit !== null) return quit === 0 ? status : quit;
    }
    return status;
  }
  const quit = await go(files, null);
  return quit !== null && quit !== 0 ? quit : status;
}
