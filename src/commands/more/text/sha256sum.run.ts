// The body of sha256sum; its spec, in sha256sum.ts, loads this the first time sha256sum runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { checksumDoc, runChecksum } from '../../lib/checksum';

export const doc: CommandDoc = checksumDoc('SHA-256', 256);

export function run(ctx: CommandContext): Promise<ExitCode> {
  return runChecksum(ctx, 'SHA-256');
}
