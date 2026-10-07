// The body of sha512sum; its spec, in sha512sum.ts, loads this the first time sha512sum runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { checksumDoc, runChecksum } from '../../lib/checksum';

export const doc: CommandDoc = checksumDoc('SHA-512', 512);

export function run(ctx: CommandContext): Promise<ExitCode> {
  return runChecksum(ctx, 'SHA-512');
}
