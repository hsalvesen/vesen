// The body of chgrp; its spec, in chgrp.ts, loads this the first time chgrp runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { reason } from '../../lib/files';
import { changeOwner, groupName, ownerOptions } from '../../lib/owners';

/** What --help, help and man say about chgrp, besides its spec (chgrp.ts). */
export const doc: CommandDoc = {
  description:
    "Changes the group of each FILE to GROUP, a name or a number. A file's owner may give it only to a group they are in, so the visitor may set their own files to the guest group and nothing else: anything more is 'Operation not permitted'. It prints nothing when it works; -v says what it did to each file, -c only what it changed.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was changed (or already as asked), 1 otherwise.' }],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const reference = typeof ctx.opts.reference === 'string' ? ctx.opts.reference : undefined;
  const words = [...ctx.args];
  let group: string;
  if (reference !== undefined) {
    if (words.length === 0) return ctx.usage('missing operand');
    try {
      group = ctx.fs.stat(ctx.resolve(reference)).group;
    } catch (error) {
      return ctx.fail(`failed to get attributes of '${reference}': ${reason(error)}`);
    }
  } else {
    const text = words.shift();
    if (text === undefined) return ctx.usage('missing operand');
    if (words.length === 0) return ctx.usage(`missing operand after '${text}'`);
    const found = groupName(text);
    if (found === null) return ctx.fail(`invalid group: '${text}'`);
    group = found;
  }
  const options = ownerOptions(ctx);
  let status = 0;
  for (const typed of words) {
    if (!(await changeOwner(ctx, typed, ctx.resolve(typed), { group }, options))) status = 1;
  }
  return status;
}
