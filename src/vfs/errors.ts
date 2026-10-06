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
