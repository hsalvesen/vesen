// The body of git; its spec, in git.ts, loads this the first time git runs.
//
// Only inside ~/projects/vesen, which stands for this site's own repository. There is no .git
// here: log and show read the ten newest commits from GitHub's API (commands/lib/github.ts),
// remote and branch say what the repository is, and status and diff say what is true of a
// copy nobody can change: nothing to commit. Everything that would change it says it cannot.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { GitHubFailure, OWNER_REPO_COMMITS, PAGE, REMOTE_URL, recentCommits, type Commit } from '../../lib/github';
import { netReason, stamp } from '../../lib/net-words';

/** What --help, help and man say about git, besides its spec (git.ts). */
export const doc: CommandDoc = {
  description:
    "A read-only look at this site's own repository, inside ~/projects/vesen (or with -C ~/projects/vesen): git log (--oneline, -n N) and git show (HEAD, HEAD~N or the start of a commit's hash) read the ten newest commits from GitHub's API, kept for 10 minutes because GitHub allows 60 requests an hour from one address; git remote -v, git branch, git status and git diff need nothing. Commits are shown by their author's name only. Anywhere else, git says it is not in a repository. Nothing can be committed, pushed or pulled: this copy belongs to the site.",
  man: [
    { heading: 'EXIT STATUS', body: "0 on success. 1 for a command this read-only copy cannot do. 128 outside ~/projects/vesen, or when GitHub could not be reached. 129 for bad usage." },
  ],
};

/** Commands that would change the repository or reach another one. */
const READ_ONLY = new Set([
  'add', 'am', 'apply', 'bisect', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'fetch', 'gc', 'init', 'merge', 'mv', 'pull',
  'push', 'rebase', 'reset', 'restore', 'revert', 'rm', 'stash', 'submodule', 'switch', 'tag', 'worktree',
]);

const USAGE = [
  'usage: git [-C <path>] <command> [<args>]',
  '',
  'These work here, in ~/projects/vesen:',
  '   log        Show the newest commits (--oneline, -n N)',
  '   show       Show a commit (HEAD, HEAD~N, a hash)',
  '   status     Show the working tree status',
  '   remote     Show the remote (-v)',
  '   branch     Show the branch',
  '   diff       Show changes in the working tree',
];

const fatal = async (ctx: CommandContext, message: string): Promise<ExitCode> => {
  await ctx.stderr.line(out.span(`fatal: ${message}`, { fg: 'error' }));
  return 128;
};

/** True when `dir` is ~/projects/vesen or inside it, following symbolic links such as /home/user. */
function inRepository(ctx: CommandContext, dir: string): boolean {
  let root: string;
  let here: string;
  try {
    root = ctx.fs.realpath(`${ctx.user.home}/projects/vesen`);
    here = ctx.fs.realpath(dir);
  } catch {
    return false;
  }
  return here === root || here.startsWith(`${root}/`);
}

const short = (sha: string): string => sha.slice(0, 7);

/** git's default date: `Wed Jul 15 17:31:00 2026 +1000`, in the visitor's zone. */
const gitDate = (ctx: CommandContext, ms: number): string => stamp(ctx, '%a %b %-d %H:%M:%S %Y %z', ms);

function decoration(ctx: CommandContext, index: number): string {
  if (index !== 0) return '';
  const { fmt } = ctx;
  return `${fmt.fg('yellow', '(')}${fmt.bold(fmt.fg('cyan', 'HEAD ->'))} ${fmt.bold(fmt.fg('green', 'main'))}${fmt.fg('yellow', ',')} ${fmt.bold(fmt.fg('red', 'origin/main'))}${fmt.fg('yellow', ')')}`;
}

/** A commit as git log and git show print it, without a trailing blank line. */
function fullCommit(ctx: CommandContext, commit: Commit, index: number): string[] {
  const deco = decoration(ctx, index);
  return [
    `${ctx.fmt.fg('yellow', `commit ${commit.sha}`)}${deco === '' ? '' : ` ${deco}`}`,
    ...(commit.parents.length > 1 ? [`Merge: ${commit.parents.map(short).join(' ')}`] : []),
    `Author: ${commit.author}`,
    `Date:   ${gitDate(ctx, commit.date)}`,
    '',
    ...commit.message.replace(/\s+$/, '').split('\n').map((line) => (line === '' ? '' : `    ${line}`)),
  ];
}

function onelineCommit(ctx: CommandContext, commit: Commit, index: number): string {
  const deco = decoration(ctx, index);
  const subject = commit.message.split('\n')[0] ?? '';
  return `${ctx.fmt.fg('yellow', short(commit.sha))} ${deco === '' ? '' : `${deco} `}${subject}`;
}

/** The commits, or the exit status after saying why there are none. */
async function commits(ctx: CommandContext): Promise<readonly Commit[] | ExitCode> {
  try {
    return (await recentCommits({ net: ctx.net, clock: ctx.clock, signal: ctx.signal })).commits;
  } catch (error) {
    if (error instanceof GitHubFailure) {
      if (error.kind === 'rate-limit') {
        const after = error.resetAt === null ? 'later' : `after ${stamp(ctx, '%H:%M', error.resetAt)}`;
        return fatal(ctx, `GitHub allows 60 requests an hour from your address, and they are used up; try again ${after}, or see ${OWNER_REPO_COMMITS}`);
      }
      return fatal(ctx, `unable to read the commits from GitHub: ${error.message}`);
    }
    if (!ctx.net.isError(error) || error.kind === 'abort') throw error;
    return fatal(ctx, `unable to access 'https://api.github.com/': ${netReason(error)}`);
  }
}

async function log(ctx: CommandContext, words: readonly string[]): Promise<ExitCode> {
  let oneline = false;
  let max: number | null = null;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const count = /^(?:-n|--max-count=?)(\d*)$/.exec(word) ?? /^-(\d+)$/.exec(word);
    if (word === '--oneline') oneline = true;
    else if (count !== null) {
      const value = count[1] !== '' && count[1] !== undefined ? count[1] : words[(i += 1)];
      if (value === undefined || !/^\d+$/.test(value)) return fatal(ctx, `'${value ?? ''}': not an integer`);
      max = Number(value);
    } else if (word === '--no-decorate' || word === '--decorate' || word === '--no-color' || word === '--color') {
      // The look of it; vesen has one.
    } else {
      return fatal(ctx, `unrecognized argument: ${word}`);
    }
  }
  const found = await commits(ctx);
  if (typeof found === 'number') return found;
  const shown = max === null ? found : found.slice(0, max);
  const lines = oneline ? shown.map((commit, i) => onelineCommit(ctx, commit, i)) : shown.flatMap((commit, i) => [...fullCommit(ctx, commit, i), ...(i < shown.length - 1 ? [''] : [])]);
  if (lines.length > 0) await ctx.stdout.write(`${lines.join('\n')}\n`);
  if (found.length >= PAGE && (max === null || max > PAGE)) {
    await ctx.stderr.line(out.span(`git: the ${PAGE} newest commits, as GitHub's API gives them; the rest are at ${OWNER_REPO_COMMITS}`, { fg: 'muted' }));
  }
  return 0;
}

/** The commit a revision names among the newest: HEAD, HEAD~N, HEAD^, or the start of a hash. */
function revision(found: readonly Commit[], rev: string): Commit | null {
  const back = /^(?:HEAD|@)(?:~(\d*)|(\^+))?$/.exec(rev);
  if (back !== null) {
    const steps = back[2] !== undefined ? back[2].length : back[1] === undefined ? 0 : back[1] === '' ? 1 : Number(back[1]);
    return found[steps] ?? null;
  }
  if (!/^[0-9a-f]{4,40}$/i.test(rev)) return null;
  const matches = found.filter((commit) => commit.sha.startsWith(rev.toLowerCase()));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

async function show(ctx: CommandContext, words: readonly string[]): Promise<ExitCode> {
  const revs = words.filter((word) => !word.startsWith('-'));
  if (revs.length > 1) return fatal(ctx, 'vesen shows one commit at a time');
  const rev = revs[0] ?? 'HEAD';
  const found = await commits(ctx);
  if (typeof found === 'number') return found;
  const commit = revision(found, rev);
  if (commit === null) return fatal(ctx, `ambiguous argument '${rev}': unknown revision or path not in the working tree.`);
  await ctx.stdout.write(`${fullCommit(ctx, commit, found.indexOf(commit)).join('\n')}\n\n`);
  const url = `${OWNER_REPO_COMMITS.replace(/\/commits$/, '/commit/')}${commit.sha}`;
  await ctx.stdout.line(out.span('The changes are on GitHub: ', { fg: 'muted' }), out.link(url, url));
  return 0;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const words = [...ctx.args];
  let dir = ctx.cwd;
  while (words[0] === '-C' || words[0] === '--no-pager' || words[0] === '-P') {
    const flag = words.shift();
    if (flag !== '-C') continue;
    const path = words.shift();
    if (path === undefined) return ctx.usage('option -C requires a value');
    const target = ctx.resolve(path);
    let isDir = false;
    try {
      isDir = ctx.fs.stat(target).type === 'directory';
    } catch {
      isDir = false;
    }
    if (!isDir) return fatal(ctx, `cannot change to '${path}': No such file or directory`);
    dir = target;
  }
  const [command, ...rest] = words;
  if (command === undefined) {
    await ctx.stderr.write(`${USAGE.join('\n')}\n`);
    return 1;
  }
  if (command === '--version' || command === 'version') {
    await ctx.stdout.write(`git (vesen) ${__APP_VERSION__}\n`);
    return 0;
  }
  if (command.startsWith('-')) return ctx.usage(`unknown option: ${command}`);
  const known = ['log', 'show', 'status', 'remote', 'branch', 'diff'].includes(command);
  if (!known && !READ_ONLY.has(command)) {
    await ctx.stderr.line(out.span(`git: '${command}' is not a git command. See 'git --help'.`, { fg: 'error' }));
    return 1;
  }
  if (command === 'clone' || command === 'init') {
    // Neither needs a repository, so wherever it is typed the answer is the same.
    await ctx.stderr.line(
      out.span(`git: '${command}' is not available here: a browser tab cannot fetch or create repositories (log, show, status, remote, branch and diff work in ~/projects/vesen)`, { fg: 'error' }),
    );
    return 1;
  }
  if (!inRepository(ctx, dir)) return fatal(ctx, 'not a git repository (or any of the parent directories): .git');
  if (READ_ONLY.has(command)) {
    await ctx.stderr.line(out.span(`git: '${command}' is not available here: this copy of vesen's repository is read-only (log, show, status, remote, branch and diff work)`, { fg: 'error' }));
    return 1;
  }
  switch (command) {
    case 'log':
      return log(ctx, rest);
    case 'show':
      return show(ctx, rest);
    case 'status':
      if (rest.some((word) => word === '-s' || word === '--short' || word.startsWith('--porcelain'))) return 0;
      await ctx.stdout.write("On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean\n");
      return 0;
    case 'remote':
      if (rest.length === 0) await ctx.stdout.write('origin\n');
      else if (rest[0] === '-v' || rest[0] === '--verbose') await ctx.stdout.write(`origin\t${REMOTE_URL} (fetch)\norigin\t${REMOTE_URL} (push)\n`);
      else if (rest[0] === 'get-url') await ctx.stdout.write(`${REMOTE_URL}\n`);
      else {
        await ctx.stderr.line(out.span(`git: 'remote ${rest[0] ?? ''}' is not available here: this copy of vesen's repository is read-only`, { fg: 'error' }));
        return 1;
      }
      return 0;
    case 'branch':
      if (rest.some((word) => !word.startsWith('-') || /^-[dDmMcC]$/.test(word))) {
        await ctx.stderr.line(out.span("git: 'branch' can only list here: this copy of vesen's repository is read-only", { fg: 'error' }));
        return 1;
      }
      await ctx.stdout.write(`* ${ctx.fmt.fg('green', 'main')}\n`);
      return 0;
    default:
      // diff: a working tree nobody can change has no changes.
      return 0;
  }
}
