// Loads an optional dev dependency for a test without failing the file when it is missing.
// Node's require is used on purpose: a missing package then throws here, at run time, instead of
// failing Vite's import analysis, so the suite can skip itself with a reason.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface Optional<T> {
  module: T | null;
  /** Appended to a suite name, so a skipped suite says why in the test report. */
  note: string;
}

export function optionalModule<T>(name: string): Optional<T> {
  try {
    return { module: require(name) as T, note: '' };
  } catch {
    return { module: null, note: ` (skipped: '${name}' is not installed)` };
  }
}
