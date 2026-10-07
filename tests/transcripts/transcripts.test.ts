// Golden transcripts of the ported commands (docs/plan/designs/shell-architecture.md, "Command
// contracts"): each command's session run at 40, 80 and 120 columns, with stdout on the terminal
// and into a pipe, from a fresh VFS with a frozen clock. Read README.md in this folder before
// updating any of them.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { session } from '../harness';

// Pinned, so a release does not rewrite the banner and the man page footers.
beforeAll(() => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test');
});

const WIDTHS = [40, 80, 120] as const;

/** Each command's session: the lines typed, in order, in one shell. */
const SESSIONS: Readonly<Record<string, readonly string[]>> = {
  echo: [
    'echo hello   world',
    'echo "a  b" c',
    'echo -n no newline; echo',
    "echo -e 'one\\ttwo\\nthree'",
    "echo 'a\\tb'",
    'echo -x -- -n',
    'echo "5 > 3" | cat',
    'echo $HOME $?',
  ],
  printf: [
    "printf '%s\\n' one two three",
    "printf '%-8s|%6.2f|\\n' pi 3.14159",
    "printf '%d %x %o %X %#x %c\\n' 255 255 255 255 255 vesen",
    "printf '%05d|%+d|% d|%-5d|\\n' 42 42 42 42",
    "printf '%e %g %g\\n' 12345.678 0.0001 123456789",
    "printf '%d\\n' abc 12x",
    "printf '%z'",
    'printf',
  ],
  cat: [
    'cat .bashrc',
    'cat -n .profile',
    'cat nope readme.md documents /etc/shadow',
    "printf 'a\\n\\n\\n\\tb\\n' > f; cat -sA f",
    'echo piped | cat - .vimrc',
    'cat README.md',
  ],
  ls: [
    'ls',
    'ls -a',
    'ls -la ~',
    'ls -lh /etc',
    'ls /',
    'ls -F ~/bin /home',
    'ls -R projects',
    'ls -C documents projects',
    'ls nope',
    'ls /root',
    'ls -z',
  ],
  mkdir: ['mkdir notes', 'mkdir -pv a/b/c', 'mkdir a', 'mkdir -m 700 private', 'ls -ld notes private', 'mkdir', 'mkdir /etc/x'],
  touch: ['touch a.txt b.txt', 'ls -l a.txt b.txt', 'touch -c ghost; ls ghost', 'touch /etc/x /etc/passwd', 'touch'],
  rm: ['rm README.md', 'rm -rv projects', 'rm documents', 'rm -dv .local/share/applications', 'rm nope', 'rm -f nope', 'rm -r .', 'rm -r /', 'rm /etc/passwd', 'ls'],
  rmdir: ['mkdir empty; rmdir -v empty', 'rmdir -pv .local/share/applications', 'rmdir videos', 'rmdir nope', 'rmdir .'],
  cp: [
    'cp README.md copy.md',
    'cp -v history.txt .bashrc documents/',
    'cp -rv projects/vesen backup',
    'cp documents d2',
    'cp nope x',
    'cp README.md README.md',
    'cp /etc/shadow x',
    'ls',
  ],
  mv: ['mv -v README.md readme.md', 'mv history.txt documents/', 'mv projects projects/sub', 'mv nope x', 'mv readme.md /etc/', 'ls', 'ls documents'],
  ln: ['ln -s documents/linux.txt linux', 'ln -sv /etc/hostname', 'ls -l linux hostname', 'ln -s x linux', 'ln README.md hard', 'ln -s y /etc/z'],
  stat: ['stat .bashrc', 'stat /home/user', "stat -c '%A %a %U:%G %s %F %n' .bashrc /etc /dev/null", 'stat nope'],
  history: [
    'pwd',
    'cd documents',
    'echo the quick brown fox jumps over the lazy dog, twice over',
    'cd ..',
    'history',
    'history 2',
    'history -d 1',
    'history',
    'history -c',
    'history',
  ],
  clear: ['echo before', 'clear', 'echo after; clear | cat; echo cleared again'],
  // Each variant runs at once, and the theme and CRT mode are the app's, so these sessions only
  // read them; setting them is in src/commands/portfolio/portfolio.test.ts.
  help: ['help', 'help pwd cd', 'help keys', 'help nope'],
  man: ['man pwd', 'man 1 nope', 'whatis ls cd', 'apropos theme', 'man -k zzz'],
  theme: ['theme ls', 'theme set nope', 'theme set', 'theme a b'],
  cathode: ['cathode ls', 'cathode set neon', 'cathode quality', 'cathode quality ultra'],
  banner: ['banner'],
  builtins: [
    'type ll cd ls if nope',
    'which cat nope',
    'command -v ls ll cd',
    'set -o',
    'set -o noclobber; echo a > f; echo b > f',
    'unset HOME; echo "[$HOME]"',
    '[ -d documents ] && echo yes; test 1 -gt 2; echo $?',
    'printenv USER; env GREETING=hi printenv GREETING',
    'date; date -u +%s',
    'exit 3',
  ],
  // The text tools (src/commands/more/text): the screen as each draws it, and in a pipe.
  grep: [
    'grep -n alias .bashrc',
    'grep -c alias .bashrc .profile',
    'grep -rl Hello',
    "grep -E '^(root|guest):' /etc/passwd",
    'grep -A1 -n EDITOR .profile',
    'grep x nope documents',
    "grep -E '(a+)+$' .profile",
  ],
  column: ['seq 30 | column', 'seq 30 | column -x', 'column -t -s : /etc/passwd', "printf 'name size\\nREADME.md 1K\\n' | column -t"],
  wc: ['wc README.md', 'wc -l .bashrc .profile', 'echo one two | wc', 'wc documents nope'],
  diff: ["printf 'a\\nb\\nc\\n' > old; printf 'a\\nB\\nc\\nd\\n' > new", 'diff old new', 'diff -u old new', 'diff -q old new', 'diff old nope'],
  sort: ['sort /etc/shells', 'cut -d : -f 7 /etc/passwd | sort | uniq -c', 'sort -t : -k 3,3n /etc/passwd', "printf 'b\\na\\n' | sort -c"],
};

interface Variant {
  readonly tty: boolean;
  readonly cols: number;
}

const VARIANTS: readonly Variant[] = [true, false].flatMap((tty) => WIDTHS.map((cols) => ({ tty, cols })));

/** Control characters in caret notation, as cat -v shows them, so a transcript is plain text. */
function visible(row: string): string {
  return row.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) ^ 0x40)}`).trimEnd();
}

/** Each line's output and status in one session of a variant. */
async function outputs(lines: readonly string[], variant: Variant): Promise<string[]> {
  const s = await session(variant);
  const shown: string[] = [];
  try {
    for (const line of lines) {
      const result = await s.run(line);
      shown.push([...result.screen.map(visible), `? ${result.status}`].join('\n'));
    }
  } finally {
    s.stop();
  }
  return shown;
}

function describeVariants(variants: readonly Variant[]): string {
  const parts: string[] = [];
  for (const tty of [true, false]) {
    const cols = variants.filter((variant) => variant.tty === tty).map((variant) => variant.cols);
    if (cols.length === WIDTHS.length) parts.push(tty ? 'terminal' : 'pipe');
    else if (cols.length > 0) parts.push(`${tty ? 'terminal' : 'pipe'} at ${cols.join(', ')} columns`);
  }
  return parts.join('; ');
}

describe('command transcripts', () => {
  for (const [name, lines] of Object.entries(SESSIONS)) {
    it(name, async () => {
      const runs = await Promise.all(VARIANTS.map((variant) => outputs(lines, variant)));
      const rows = [
        `# ${name}: one session, with stdout on the terminal and into a pipe, at 40, 80 and 120 columns.`,
        '# Rows starting with "! " went to stderr, and "? N" is the exit status. Where the variants',
        '# differ, each output is under the variants it belongs to. See README.md.',
        '',
      ];
      lines.forEach((line, i) => {
        rows.push(`$ ${line}`);
        // Variants whose output agrees are written once.
        const groups: { variants: Variant[]; text: string }[] = [];
        VARIANTS.forEach((variant, v) => {
          const text = runs[v]?.[i] ?? '';
          const same = groups.find((group) => group.text === text);
          if (same) same.variants.push(variant);
          else groups.push({ variants: [variant], text });
        });
        if (groups.length === 1) rows.push(groups[0]?.text ?? '');
        else for (const group of groups) rows.push(`[${describeVariants(group.variants)}]`, group.text);
      });
      await expect(`${rows.join('\n')}\n`).toMatchFileSnapshot(`./${name}.txt`);
    });
  }
});
