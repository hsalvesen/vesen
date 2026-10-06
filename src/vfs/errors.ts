// Linux's wording for each file-system error, so `cat nope` says what coreutils says.

import { VfsError, type VfsCode } from './types';

const STRERROR: Readonly<Record<VfsCode, string>> = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  ENOTEMPTY: 'Directory not empty',
  ELOOP: 'Too many levels of symbolic links',
  EINVAL: 'Invalid argument',
  ENOSPC: 'No space left on device',
  ENAMETOOLONG: 'File name too long',
};

/** The C library's message for an error code: ENOENT → "No such file or directory". */
export function strerror(code: VfsCode): string {
  return STRERROR[code];
}

export function isVfsError(error: unknown): error is VfsError {
  return error instanceof VfsError;
}

/** "path: No such file or directory", the form shells and most coreutils print. */
export function vfsMessage(error: VfsError, path: string = error.path): string {
  return `${path}: ${strerror(error.code)}`;
}

/**
 * Why rm refuses an operand before touching anything, in GNU rm's words, or null when it may
 * try. `.` and `..` are never removed (F020), and `/` only with a flag vesen does not have.
 * `operand` is the path as typed; `resolved` is where it leads.
 */
export function rmRefusal(operand: string, resolved: string, recursive: boolean): string[] | null {
  const last = operand.replace(/\/+$/, '').split('/').pop();
  if (last === '.' || last === '..') return [`rm: refusing to remove '.' or '..' directory: skipping '${operand}'`];
  if (resolved === '/') {
    return recursive
      ? ["rm: it is dangerous to operate recursively on '/'", 'rm: use --no-preserve-root to override this failsafe']
      : [`rm: cannot remove '${operand}': Is a directory`];
  }
  return null;
}
