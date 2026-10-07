// The bodies of id and groups; their specs, in id.ts and groups.ts, load this the first time
// either runs. Both read the accounts /etc/passwd and /etc/group are written from.

import type { CommandContext, CommandDoc, ExitCode, User } from '../../../shell/types';
import { ACCOUNTS, GROUPS } from '../../../vfs/identity';

/** What --help, help and man say about id, besides its spec (id.ts). */
export const doc: CommandDoc = {
  description:
    'Prints the user and group ids of USER, or of you: guest, uid 1000. With -u, -g or -G, only the user id, the group id or every group id, and with -n their names. The real and effective ids are the same here, so -r changes nothing. The accounts are the ones in /etc/passwd and /etc/group: root, guest, has (the owner) and nobody.',
  man: [{ heading: 'EXIT STATUS', body: "0, or 1 when a USER does not exist or the options cannot go together." }],
};

/** What --help, help and man say about groups, besides its spec (groups.ts). */
export const groupsDoc: CommandDoc = {
  description:
    "Prints the names of the groups you are in, or for each USER, the user's name, a colon and theirs. The accounts are the ones in /etc/passwd and /etc/group.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 when a USER does not exist.' }],
};

interface Who {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly groups: readonly number[];
}

/** A user by name: the visitor as the session knows them, or an account; null for none. */
function findUser(ctx: CommandContext, name: string | undefined): Who | null {
  const self: User = ctx.user;
  if (name === undefined || name === self.name) return { name: self.name, uid: self.uid, gid: self.gid, groups: groupsOf(self.name, self.gid, self.groups) };
  const account = ACCOUNTS.find((found) => found.name === name || String(found.uid) === name);
  return account === undefined ? null : { name: account.name, uid: account.uid, gid: account.gid, groups: groupsOf(account.name, account.gid) };
}

/** A user's groups: the primary one first, then those that list them as a member. */
function groupsOf(name: string, gid: number, more: readonly number[] = []): number[] {
  const all = [gid, ...more, ...GROUPS.filter((group) => group.members.includes(name)).map((group) => group.gid)];
  return all.filter((value, index) => all.indexOf(value) === index);
}

const groupName = (gid: number): string => GROUPS.find((group) => group.gid === gid)?.name ?? String(gid);
const both = (n: number, name: string): string => `${n}(${name})`;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const only = (['user', 'group', 'groups'] as const).filter((key) => ctx.opts[key] === true);
  if (only.length > 1) return ctx.fail('cannot print "only" of more than one choice');
  const names = ctx.opts.name === true;
  if (only.length === 0 && (names || ctx.opts.real === true)) return ctx.fail('cannot print only names or real IDs in default format');
  let status = 0;
  for (const name of ctx.args.length === 0 ? [undefined] : ctx.args) {
    const who = findUser(ctx, name);
    if (who === null) {
      status = await ctx.fail(`'${name ?? ''}': no such user`);
      continue;
    }
    let line: string;
    if (only[0] === 'user') line = names ? who.name : String(who.uid);
    else if (only[0] === 'group') line = names ? groupName(who.gid) : String(who.gid);
    else if (only[0] === 'groups') line = who.groups.map((gid) => (names ? groupName(gid) : String(gid))).join(' ');
    else {
      const groups = who.groups.map((gid) => both(gid, groupName(gid))).join(',');
      line = `uid=${both(who.uid, who.name)} gid=${both(who.gid, groupName(who.gid))} groups=${groups}`;
    }
    await ctx.stdout.write(`${line}\n`);
  }
  return status;
}

export async function runGroups(ctx: CommandContext): Promise<ExitCode> {
  let status = 0;
  for (const name of ctx.args.length === 0 ? [undefined] : ctx.args) {
    const who = findUser(ctx, name);
    if (who === null) {
      status = await ctx.fail(`'${name ?? ''}': no such user`);
      continue;
    }
    const list = who.groups.map(groupName).join(' ');
    await ctx.stdout.write(`${name === undefined ? list : `${who.name} : ${list}`}\n`);
  }
  return status;
}
