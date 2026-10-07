// A command that spends real data (speedtest) asks first on a phone, on a cellular or slow
// connection, or with Data Saver on (docs/plan/02-architecture-and-contracts.md, section 4):
// the spec says how much and where (CommandSpec.dataCost), and the shell asks before it runs.

import type { CommandSpec } from './types';

/** Where the line runs, as far as the browser says. */
export interface DataConditions {
  readonly touch: boolean;
  readonly saveData: boolean;
  readonly cellular: boolean;
}

/** About how many megabytes, as the question says it: at least 1. */
export function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1e6));
}

/**
 * The question to ask before `spec` runs `argv` here, without its `[y/N]`, or null when it need
 * not ask: no cost, none of its conditions here, or nothing to spend on this line.
 */
export function dataCostQuestion(spec: CommandSpec, argv: readonly string[], here: DataConditions): string | null {
  const cost = spec.dataCost;
  if (cost === undefined || !cost.confirmOn.some((condition) => here[condition])) return null;
  const bytes = typeof cost.bytes === 'function' ? cost.bytes(argv) : cost.bytes;
  if (!(bytes > 0)) return null;
  return `${spec.name} downloads about ${megabytes(bytes)} MB. Continue?`;
}
