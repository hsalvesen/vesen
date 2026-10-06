import { describe, expect, it } from 'vitest';
import { VfsError } from './types';

describe('VfsError', () => {
  it('carries the code, path and syscall for coreutils-style messages', () => {
    const error = new VfsError('ENOENT', '/home/guest/nope', 'open');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'VfsError', code: 'ENOENT', path: '/home/guest/nope', syscall: 'open' });
    expect(new VfsError('EACCES', '/etc/x').syscall).toBe('');
  });
});
