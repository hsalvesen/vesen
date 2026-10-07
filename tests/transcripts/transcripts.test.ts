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
  touch: [
    'touch a.txt b.txt',
    'ls -l a.txt b.txt',
    'touch -c ghost; ls ghost',
    'touch /etc/x /etc/passwd',
    'touch',
    "touch -d '2026-01-02 03:04' a.txt; touch -r a.txt b.txt; touch -t 202501020304.05 c.txt",
    'ls -l a.txt b.txt c.txt',
    'touch -d nonsense x',
  ],
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
  chmod: [
    'chmod 755 README.md',
    'chmod -v u-x,go-w README.md bin/deploy',
    'chmod -c a+r documents/linux.txt',
    'chmod -R go-rwx projects; ls -l projects',
    'chmod 666 history.txt; chmod -w history.txt',
    'chmod 777 /etc/passwd',
    'chmod xyz README.md',
    'chmod',
  ],
  chown: ['chown guest:guest README.md', 'chown -v guest README.md', 'chown has README.md', 'chown -v :has history.txt', 'chown bob README.md', 'chown guest'],
  chgrp: ['chgrp -v guest README.md', 'chgrp -R guest projects', 'chgrp has README.md', 'chgrp bob README.md'],
  tree: ['tree projects', 'tree -L 1 /', 'tree -a -I .ssh ~', 'tree -df projects', 'tree --dirsfirst --noreport /home', 'tree nope', 'tree -L 0'],
  find: [
    "find . -name '*.txt'",
    'find projects -maxdepth 1 -type d',
    "find . -name .ssh -prune -o -name 'c*' -print",
    "find scripts -type f -exec echo found: {} \\;",
    'find src bin -type f -exec ls -l {} +',
    'find src/main.c -ls',
    'find downloads -type f -delete; ls downloads',
    'find nope /root',
    'find . -name a b',
    'find . \\( -name a',
  ],
  du: ['du projects', 'du -ach projects', 'du -sh ~ /usr', 'du -h -d 1 /home/guest/projects', 'du /root', 'du -sa'],
  df: ['df', 'df -h', 'df -hT ~', 'df nope'],
  basename: ['basename /usr/bin/ls', 'basename documents/linux.txt .txt', 'basename -s .sh scripts/backup.sh bin/deploy', 'basename a b c'],
  dirname: ['dirname /usr/bin/ls documents/linux.txt README.md / a/', 'dirname'],
  realpath: ['realpath . /bin/ls /home/user/../user/README.md', 'realpath -m drafts/new.txt', 'realpath --relative-to=documents projects', 'realpath -e nope', 'realpath nope/x'],
  readlink: ['readlink /bin /home/user', 'readlink -f /home/user/README.md', 'readlink README.md', 'readlink -v README.md'],
  mktemp: ['mktemp', 'mktemp -d', 'mktemp notes.XXXXXX', 'ls -la /tmp', 'mktemp fooXX', 'mktemp /etc/xXXXX'],
  file: ['file *', 'file .ssh/* /bin /dev/null /proc/cpuinfo /etc/shadow nope', 'file -i README.md src/main.c', 'file'],
  truncate: ['truncate -s 0 history.txt', 'truncate -s 1K blank; truncate -s -24 blank; ls -l history.txt blank', 'file blank', 'truncate -s 1G big', 'truncate x'],
  sync: ['sync', 'sync README.md nope'],
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
