// The body of finger; its spec, in finger.ts, loads this the first time finger runs.

import { out, type Span } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { ACCOUNTS, type Account } from '../../../vfs/identity';
import { TERMINAL } from '../../lib/procs';
import { bootTime, clockText, ctimeText, MONTH_NAMES, readText, wallClock } from '../../lib/sysread';

/** What --help, help and man say about finger, besides its spec (finger.ts). */
export const doc: CommandDoc = {
  description:
    "Shows what there is to know about USER: the login name and real name, the home folder and shell, whether they are logged on, and their plan, from ~/.plan. `finger has` shows the owner, with his plan and his about.md. A USER matches a login name, or a word of a real name unless -m is given. With no USER, a line for each user logged on, which here is you.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 when a USER matched nobody.' }],
};

const URL = /(https?:\/\/[^\s)]+|mailto:[^\s)]+)/g;

/** A line of text with its web and mail addresses as links, on a terminal. */
function linked(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(URL)) {
    const at = match.index ?? 0;
    if (at > last) spans.push(out.span(text.slice(last, at)));
    spans.push(out.link(match[0], match[0]));
    last = at + match[0].length;
  }
  if (last < text.length) spans.push(out.span(text.slice(last)));
  return spans;
}

/** `Oct  6 19:55`, as finger writes a login time. */
function loginTime(ctx: CommandContext): string {
  const t = wallClock(ctx, bootTime(ctx));
  return `${(MONTH_NAMES[t.month - 1] ?? '').slice(0, 3)} ${String(t.day).padStart(2)} ${clockText(t).slice(0, 5)}`;
}

/** The accounts a USER names: its login name, or (unless -m) a word of a real name. */
function lookup(name: string, loginOnly: boolean): Account[] {
  const exact = ACCOUNTS.filter((account) => account.name === name);
  if (exact.length > 0 || loginOnly) return exact;
  const lower = name.toLowerCase();
  return ACCOUNTS.filter((account) => account.gecos.toLowerCase().split(/\s+/).includes(lower));
}

function shortRows(ctx: CommandContext, accounts: readonly Account[]): string[] {
  const rows = [`${'Login'.padEnd(10)}${'Name'.padEnd(18)}${'Tty'.padEnd(9)}${'Idle'.padEnd(6)}Login Time`];
  for (const account of accounts) {
    const on = account.name === ctx.user.name;
    rows.push(`${account.name.padEnd(10)}${account.gecos.padEnd(18)}${(on ? TERMINAL : '*').padEnd(9)}${''.padEnd(6)}${on ? loginTime(ctx) : 'No logins'}`.trimEnd());
  }
  return rows;
}

function longLines(ctx: CommandContext, account: Account): string[] {
  const lines = [`Login: ${account.name.padEnd(32)}Name: ${account.gecos}`, `Directory: ${account.home.padEnd(28)}Shell: ${account.shell}`];
  if (account.name === ctx.user.name) lines.push(`On since ${ctimeText(wallClock(ctx, bootTime(ctx))).slice(0, 16)} on ${TERMINAL}`);
  else lines.push('Never logged in.');
  lines.push('No mail.');
  const plan = readText(ctx, `${account.home}/.plan`);
  if (plan === null || plan.trim() === '') lines.push('No Plan.');
  else lines.push('Plan:', ...plan.replace(/\n$/, '').split('\n'));
  const about = readText(ctx, `${account.home}/about.md`);
  if (about !== null && about.trim() !== '') lines.push('', 'About:', ...about.replace(/\n$/, '').split('\n'));
  return lines;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const loginOnly = ctx.opts.m === true;
  let status = 0;
  const accounts: Account[] = [];
  for (const name of ctx.args) {
    const found = lookup(name, loginOnly);
    if (found.length === 0) {
      status = await ctx.fail(`${name}: no such user.`);
      continue;
    }
    for (const account of found) if (!accounts.includes(account)) accounts.push(account);
  }
  let lines: string[];
  if (ctx.args.length === 0 && ctx.opts.l !== true) {
    lines = shortRows(ctx, ACCOUNTS.filter((account) => account.name === ctx.user.name));
  } else if (ctx.opts.s === true) {
    lines = accounts.length > 0 ? shortRows(ctx, accounts) : [];
  } else {
    const chosen = ctx.args.length === 0 ? ACCOUNTS.filter((account) => account.name === ctx.user.name) : accounts;
    lines = chosen.flatMap((account, i) => (i === 0 ? longLines(ctx, account) : ['', ...longLines(ctx, account)]));
  }
  if (lines.length === 0) return status;
  if (ctx.stdout.isTTY) await ctx.stdout.block(out.lines(lines.map(linked)));
  else await ctx.stdout.write(`${lines.join('\n')}\n`);
  return status;
}
