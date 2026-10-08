// What chown and chgrp share: reading OWNER[:GROUP], and changing each FILE (and with -R what is
// in it) in GNU's words. Only root gives files away, so the visitor may set a file of their own
// to themselves and their own group, and is refused everything else with EPERM, as on Linux.

import type { CommandContext } from '../../shell/types';
import { ACCOUNTS, GROUPS } from '../../vfs/identity';
import type { Stat } from '../../vfs/types';
import { childPath, errorCode, reason } from './files';

/** What to set: an owner, a group, or both; neither leaves the file as it is. */
export interface OwnerChange {
  readonly owner?: string;
  readonly group?: string;
}

/** A user name, or a number as given (an unknown number keeps its digits); null for an unknown name. */
export function userName(text: string): string | null {
  const named = ACCOUNTS.find((account) => account.name === text);
  if (named !== undefined) return named.name;
  if (!/^\d+$/.test(text)) return null;
  return ACCOUNTS.find((account) => account.uid === Number(text))?.name ?? String(Number(text));
}

/** A group name, or a number as given; null for an unknown name. */
export function groupName(text: string): string | null {
  const named = GROUPS.find((group) => group.name === text);
  if (named !== undefined) return named.name;
  if (!/^\d+$/.test(text)) return null;
  return GROUPS.find((group) => group.gid === Number(text))?.name ?? String(Number(text));
}

/** The group a user logs in with, for `chown has:`. */
function loginGroup(user: string): string | undefined {
  const account = ACCOUNTS.find((found) => found.name === user);
  return account === undefined ? undefined : GROUPS.find((group) => group.gid === account.gid)?.name;
}

/**
 * chown's OWNER[:[GROUP]], or :GROUP, or the old OWNER.GROUP; `{ error }` in GNU's words for a
 * name that is nobody's.
 */
export function parseOwnerSpec(text: string): OwnerChange | { readonly error: string } {
  let at = text.indexOf(':');
  // The old OWNER.GROUP, only when the whole of it is not a user's name.
  if (at === -1 && text.includes('.') && userName(text) === null) at = text.indexOf('.');
  const userPart = at === -1 ? text : text.slice(0, at);
  const groupPart = at === -1 ? undefined : text.slice(at + 1);
  const change: { owner?: string; group?: string } = {};
  if (userPart !== '') {
    const owner = userName(userPart);
    if (owner === null) return { error: `invalid user: '${text}'` };
    change.owner = owner;
  }
  if (groupPart !== undefined && groupPart !== '') {
    const group = groupName(groupPart);
    if (group === null) return { error: `invalid group: '${text}'` };
    change.group = group;
  } else if (groupPart === '' && change.owner !== undefined) {
    const group = loginGroup(change.owner);
    if (group === undefined) return { error: `invalid spec: '${text}'` };
    change.group = group;
  }
  return change;
}

export interface OwnerOptions {
  readonly changes: boolean;
  readonly silent: boolean;
  readonly verbose: boolean;
  readonly recursive: boolean;
  /** -h: a link named on the line is the link, not what it points to. */
  readonly noDereference: boolean;
}

/** `guest:guest`, `guest` or the group alone, as GNU names an ownership. */
function spec(owner: string | undefined, group: string | undefined): string {
  if (owner !== undefined && group !== undefined) return `${owner}:${group}`;
  return owner ?? group ?? '';
}

/** What -v and -c say about one file. */
function describe(typed: string, change: OwnerChange, old: Stat, outcome: 'changed' | 'retained' | 'failed'): string {
  const before = spec(change.owner === undefined ? undefined : old.owner, change.group === undefined ? undefined : old.group);
  const after = spec(change.owner, change.group);
  const what = change.owner !== undefined ? 'ownership' : change.group !== undefined ? 'group' : null;
  if (what === null) return outcome === 'retained' ? `ownership of '${typed}' retained` : `no change to ownership of '${typed}'`;
  if (outcome === 'changed') return `changed ${what} of '${typed}' from ${before} to ${after}`;
  if (outcome === 'failed') return `failed to change ${what} of '${typed}' from ${before} to ${after}`;
  return `${what} of '${typed}' retained as ${after}`;
}

/** Changes the owner and group of `typed` (at `path`), and with -R what is inside; false on a failure. */
export async function changeOwner(
  ctx: CommandContext,
  typed: string,
  path: string,
  change: OwnerChange,
  options: OwnerOptions,
  top = true,
): Promise<boolean> {
  if (ctx.signal.aborted) throw ctx.signal.reason;
  let stat: Stat;
  try {
    stat = top && !options.noDereference ? ctx.fs.stat(path) : ctx.fs.lstat(path);
  } catch (error) {
    if (!options.silent) {
      const dangling = top && errorCode(error) === 'ENOENT' && isLink(ctx, path);
      await ctx.fail(dangling ? `cannot dereference '${typed}': ${reason(error)}` : `cannot access '${typed}': ${reason(error)}`);
    }
    return false;
  }
  if (stat.type === 'symlink') {
    // Inside a folder (or with -h) a link is not followed, and vesen cannot change a link's own owner.
    if (options.verbose) await ctx.stdout.write(`neither symbolic link '${typed}' nor referent has been changed\n`);
    return true;
  }
  let ok = true;
  const requested = change.owner !== undefined || change.group !== undefined;
  const differs = (change.owner !== undefined && change.owner !== stat.owner) || (change.group !== undefined && change.group !== stat.group);
  try {
    if (requested) ctx.fs.chown(path, change.owner ?? stat.owner, change.group);
    if (differs ? options.verbose || options.changes : options.verbose) {
      await ctx.stdout.write(`${describe(typed, change, stat, differs ? 'changed' : 'retained')}\n`);
    }
  } catch (error) {
    if (!options.silent) {
      await ctx.fail(`${change.owner !== undefined ? 'changing ownership' : 'changing group'} of '${typed}': ${reason(error)}`);
    }
    if (options.verbose) await ctx.stdout.write(`${describe(typed, change, stat, 'failed')}\n`);
    ok = false;
  }
  if (stat.type !== 'directory' || !options.recursive) return ok;
  let names: string[];
  try {
    names = ctx.fs.readdir(path, { all: true });
  } catch (error) {
    if (!options.silent) await ctx.fail(`cannot read directory '${typed}': ${reason(error)}`);
    return false;
  }
  for (const name of names) {
    if (!(await changeOwner(ctx, childPath(typed, name), `${path === '/' ? '' : path}/${name}`, change, options, false))) ok = false;
  }
  return ok;
}

function isLink(ctx: CommandContext, path: string): boolean {
  try {
    return ctx.fs.lstat(path).type === 'symlink';
  } catch {
    return false;
  }
}

/** The -c, -f, -v and -R settings from a chown or chgrp line. */
export function ownerOptions(ctx: CommandContext): OwnerOptions {
  return {
    changes: ctx.opts.changes === true,
    silent: ctx.opts.silent === true,
    verbose: ctx.opts.verbose === true,
    recursive: ctx.opts.recursive === true,
    noDereference: ctx.opts['no-dereference'] === true,
  };
}
