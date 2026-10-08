// Whether a command that runs another (timeout, nohup, xargs) can start it, decided before it
// tries, as execvp would: a name with a slash is that file, which must be there and executable; a
// bare name is a command (each has its stub in /usr/bin) or an executable file on $PATH. GNU's
// tools then say `failed to run command 'X': No such file or directory` and exit 127, or
// `Permission denied` and 126, rather than leaving it to the shell's `command not found`.

import type { CommandContext, ExitCode } from '../../shell/types';
import { allCommands } from './catalogue';
import { searchPath } from './lookup';

/** Why a command cannot be run, in strerror's words, and the status that means. */
export interface CannotRun {
  readonly reason: 'No such file or directory' | 'Permission denied';
  readonly status: ExitCode;
}

const MISSING: CannotRun = { reason: 'No such file or directory', status: 127 };
const DENIED: CannotRun = { reason: 'Permission denied', status: 126 };

/** Null when `name` can be run; otherwise why not. Waits for the catalogue before calling a name missing. */
export async function cannotRun(ctx: CommandContext, name: string): Promise<CannotRun | null> {
  if (name.includes('/')) {
    if (!ctx.fs.exists(ctx.resolve(name))) return MISSING;
    return searchPath(ctx, name, false).length > 0 ? null : DENIED;
  }
  if (ctx.shell.registry.get(name) === undefined) await allCommands(ctx);
  return ctx.shell.registry.get(name) !== undefined || searchPath(ctx, name, false).length > 0 ? null : MISSING;
}
