// The body of sha1sum; its spec, in sha1sum.ts, loads this the first time sha1sum runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { checksumDoc, runChecksum } from '../../lib/checksum';

export const doc: CommandDoc = checksumDoc('SHA-1', 160);

export function run(ctx: CommandContext): Promise<ExitCode> {
  return runChecksum(ctx, 'SHA-1');
}
