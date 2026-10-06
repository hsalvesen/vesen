import type { Block } from '../output/model';

/**
 * What one run printed. Legacy commands return HTML strings, rendered through the sanitising
 * legacyHtml block; ported commands return blocks.
 */
export type CommandOutput = string | readonly Block[];

/** One transcript entry: the line typed and what it printed. */
export interface Command {
  command: string;
  outputs: CommandOutput[];
}

/** The blocks to render for an output; anything else a legacy command returned is stringified first. */
export function outputBlocks(output: CommandOutput): readonly Block[] {
  // A literal rather than out.legacyHtml, which would pull every builder into the initial chunk.
  if (typeof output === 'string') return [{ type: 'legacyHtml', html: output }];
  return Array.isArray(output) ? output : [{ type: 'legacyHtml', html: String(output) }];
}
