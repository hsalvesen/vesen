import type { Block } from '../output/model';

/**
 * What one run printed: the blocks the shell's screen collected (a legacy command's HTML among
 * them as a sanitised legacyHtml block), or an HTML string the app adds itself, such as the
 * banner and its notices.
 */
export type CommandOutput = string | readonly Block[];

/** The blocks to render for an output; anything else a legacy command returned is stringified first. */
export function outputBlocks(output: CommandOutput): readonly Block[] {
  // A literal rather than out.legacyHtml, which would pull every builder into the initial chunk.
  if (typeof output === 'string') return [{ type: 'legacyHtml', html: output }];
  return Array.isArray(output) ? output : [{ type: 'legacyHtml', html: String(output) }];
}
