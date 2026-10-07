// The body of chown; its spec, in chown.ts, loads this the first time chown runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { reason } from '../../lib/files';
import { changeOwner, ownerOptions, parseOwnerSpec, type OwnerChange } from '../../lib/owners';

/** What --help, help and man say about chown, besides its spec (chown.ts). */
export const doc: CommandDoc = {
  description:
    "Changes the owner of each FILE to OWNER, and its group to GROUP when one is given: OWNER:GROUP, OWNER: for the owner's own group, or :GROUP for the group alone. Names and numbers both work. Only root may give a file away, so a visitor's chown to another user is refused with 'Operation not permitted', as on any Linux system; setting your own files to guest, or to the guest group, works. It prints nothing when it works; -v says what it did to each file, -c only what it changed.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was changed (or already as asked), 1 otherwise.' }],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const reference = typeof ctx.opts.reference === 'string' ? ctx.opts.reference : undefined;
  const words = [...ctx.args];
  let change: OwnerChange;
  if (reference !== undefined) {
    if (words.length === 0) return ctx.usage('missing operand');
    try {
      const stat = ctx.fs.stat(ctx.resolve(reference));
      change = { owner: stat.owner, group: stat.group };
    } catch (error) {
      return ctx.fail(`failed to get attributes of '${reference}': ${reason(error)}`);
    }
  } else {
    const text = words.shift();
    if (text === undefined) return ctx.usage('missing operand');
    if (words.length === 0) return ctx.usage(`missing operand after '${text}'`);
    const parsed = parseOwnerSpec(text);
    if ('error' in parsed) return ctx.fail(parsed.error);
    change = parsed;
  }
  const options = ownerOptions(ctx);
  let status = 0;
  for (const typed of words) {
    if (!(await changeOwner(ctx, typed, ctx.resolve(typed), change, options))) status = 1;
  }
  return status;
}
