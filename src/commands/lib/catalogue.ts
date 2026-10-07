// For commands that list the commands or look one up by name (help, man, whatis, apropos, which,
// type, command -v, privacy): every command is registered before they answer, the catalogue's
// too (src/commands/more), whose chunk loads after the kernel.

import { catalogueFailure, settleCommands } from '../../shell/registry';
import type { CommandContext, Registry } from '../../shell/types';

/**
 * The registry, once every command is in it. Waits for the catalogue if it has not arrived,
 * bounded by ^C and CATALOGUE_WAIT_MS. If it could not be loaded, a dim line on stderr says so
 * (once per attempt; the next command tries again), and the command goes on with what there is.
 */
export async function allCommands(ctx: CommandContext): Promise<Registry> {
  const registry = ctx.shell.registry;
  if (await settleCommands(registry, ctx.signal)) return registry;
  const failure = registry.takeFailure();
  if (failure !== undefined && !ctx.signal.aborted) await ctx.stderr.line({ text: catalogueFailure(failure), style: { fg: 'muted' } });
  return registry;
}
