import { describe, expect, it } from 'vitest';
import { VfsError } from './types';
import { basename, dirname, isWithin, join, MAX_SYMLINK_HOPS, normalise, realpath, resolve, segments, type LinkReader } from './path';

const HOME = '/home/guest';

describe('resolve (F021)', () => {
  it.each([
    // [typed, cwd, expected]
    ['documents', HOME, '/home/guest/documents'],
    ['./documents/../projects', HOME, '/home/guest/projects'],
    ['..', HOME, '/home'],
    ['../..', HOME, '/'],
    ['../../..', HOME, '/'],
    ['/', HOME, '/'],
    ['/etc/../home/./guest/', '/tmp', '/home/guest'],
    ['/..', HOME, '/'],
    ['~', '/etc', HOME],
    ['~/', '/etc', HOME],
    ['~/documents/../projects', '/etc', '/home/guest/projects'],
    ['~/..', '/etc', '/home'],
    ['~/../..', '/etc', '/'],
    ['.', '/usr/share', '/usr/share'],
    ['a//b///c', '/', '/a/b/c'],
  ])('%s from %s is %s', (typed, cwd, expected) => {
    expect(resolve(typed, cwd, HOME)).toBe(expected);
  });

  it('keeps ~user and words with a ~ inside as plain names', () => {
    expect(resolve('~has', HOME, HOME)).toBe('/home/guest/~has');
    expect(resolve('a~b', '/tmp', HOME)).toBe('/tmp/a~b');
  });
});

describe('the other helpers', () => {
  it('normalises, splits and joins', () => {
    expect(normalise('//a/./b/../c/')).toBe('/a/c');
    expect(segments('/a/../../b')).toEqual(['b']);
    expect(join('/a', 'b/', '../c')).toBe('/a/c');
  });

  it('takes the dirname and basename of a path', () => {
    expect(dirname('/home/guest/a.txt')).toBe('/home/guest');
    expect(dirname('/home')).toBe('/');
    expect(dirname('/')).toBe('/');
    expect(basename('/home/guest/a.txt')).toBe('a.txt');
    expect(basename('/home/guest/')).toBe('guest');
    expect(basename('/')).toBe('/');
    expect(basename('notes')).toBe('notes');
  });

  it('knows when a path is inside another', () => {
    expect(isWithin('/home/guest/a', '/home/guest')).toBe(true);
    expect(isWithin('/home/guest', '/home/guest')).toBe(true);
    expect(isWithin('/home/guests', '/home/guest')).toBe(false);
    expect(isWithin('/anything', '/')).toBe(true);
  });
});

describe('realpath', () => {
  /** A tree of paths: a string is a link's target, null a folder or file. */
  const reader = (tree: Record<string, string | null>): LinkReader => (path) => {
    if (!(path in tree)) throw new VfsError('ENOENT', path, 'lstat');
    const target = tree[path];
    return typeof target === 'string' ? { type: 'symlink', target } : { type: 'directory' };
  };

  it('follows relative and absolute links, and climbs .. from where a link points', () => {
    const lstat = reader({ '/home': null, '/home/guest': null, '/home/user': 'guest', '/home/guest/docs': null, '/bin': 'usr/bin', '/usr': null, '/usr/bin': null, '/etc': null, '/home/guest/up': '../../etc' });
    expect(realpath('/home/user/docs', lstat)).toBe('/home/guest/docs');
    expect(realpath('/bin', lstat)).toBe('/usr/bin');
    expect(realpath('/home/guest/up', lstat)).toBe('/etc');
    expect(realpath('/', lstat)).toBe('/');
  });

  it(`fails with ELOOP past ${MAX_SYMLINK_HOPS} links`, () => {
    const chain: Record<string, string | null> = { '/end': null, '/l0': '/end' };
    for (let i = 1; i <= MAX_SYMLINK_HOPS; i += 1) chain[`/l${i}`] = `/l${i - 1}`;
    expect(realpath(`/l${MAX_SYMLINK_HOPS - 1}`, reader(chain))).toBe('/end');
    expect(() => realpath(`/l${MAX_SYMLINK_HOPS}`, reader(chain))).toThrow(expect.objectContaining({ code: 'ELOOP' }));
    expect(() => realpath('/a', reader({ '/a': 'b', '/b': 'a' }))).toThrow(expect.objectContaining({ code: 'ELOOP' }));
  });

  it('passes on what lstat throws for a missing part', () => {
    expect(() => realpath('/nope/x', reader({}))).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });
});
