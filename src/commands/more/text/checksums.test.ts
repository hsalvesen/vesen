// base64, md5sum, sha1sum, sha256sum and sha512sum against their Linux output: known digests of
// known text, the line formats, --check, and what happens on a page without WebCrypto.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import type { Digest } from '../../../services/types';
import { decodeText, encodeBytes } from './base64.run';

const pipe = { tty: false } as const;
const out = async (line: string): Promise<string> => (await runLine(line, pipe)).stdoutPlain;

describe('base64', () => {
  it.each([
    ['echo hello | base64', 'aGVsbG8K'],
    ["printf x | base64", 'eA=='],
    ["printf xy | base64", 'eHk='],
    ["printf xyz | base64", 'eHl6'],
    ["printf '' | base64", ''],
    ["printf 'héllo' | base64", 'aMOpbGxv'],
    ['echo aGVsbG8K | base64 -d', 'hello'],
    ["printf 'aGVs\\nbG8K\\n' | base64 -d", 'hello'],
    ["echo 'aGV*sbG8K' | base64 -di", 'hello'],
    ['seq 30 | base64 -w 20 | head -n 2', 'MQoyCjMKNAo1CjYKNwo4\nCjkKMTAKMTEKMTIKMTMK'],
    ['seq 30 | base64 -w 0 | wc -l', '1'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('wraps at 76 columns by default', async () => {
    const lines = (await out('seq 100 | base64')).split('\n');
    expect(lines[0]).toHaveLength(76);
    expect(lines.every((line) => line.length <= 76)).toBe(true);
  });

  it('writes what decodes before saying the input is invalid, and exits 1', async () => {
    expect(await runLine('echo aGVsbG8 | base64 -d', pipe)).toMatchObject({ status: 1, stdoutPlain: 'hello', stderrPlain: 'base64: invalid input' });
    expect(await runLine("echo 'aGV*sbG8K' | base64 -d", pipe)).toMatchObject({ status: 1, stdoutPlain: 'he', stderrPlain: 'base64: invalid input' });
    expect(await runLine('base64 -w x .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "base64: invalid wrap size: 'x'" });
    expect(await runLine('base64 a b', pipe)).toMatchObject({ status: 1, stderrPlain: "base64: extra operand 'b'\nTry 'base64 --help' for more information." });
  });

  it('round-trips any bytes', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let n = 0; n <= 10; n += 1) {
      const decoded = decodeText(encodeBytes(bytes.slice(0, n)), false);
      expect(decoded.valid).toBe(true);
      expect([...decoded.bytes]).toEqual([...bytes.slice(0, n)]);
    }
  });
});

describe('checksums', () => {
  it.each([
    ['echo hello | md5sum', 'b1946ac92492d2347c6235b4d2611184  -'],
    ["printf '' | md5sum", 'd41d8cd98f00b204e9800998ecf8427e  -'],
    ['echo hello | sha1sum', 'f572d396fae9206628714fb2ce00f72e94f2258f  -'],
    ['echo hello | sha256sum', '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  -'],
    [
      'echo hello | sha512sum',
      'e7c22b994c59d9cf2b48e549b1e24666636045930d3da7c1acb299d1c3b7f931f94aae41edda2c2b207a36e10f8bcb8d45223e54878f5b316e7ce3b6bc019629  -',
    ],
    ["printf 'abc' | sha256sum", 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -'],
    // Text is hashed as its UTF-8 bytes, as on Linux: é is c3 a9.
    ["printf 'é' | md5sum", '66ddcd97cfdeabb2f6fb8a999b4bc76f  -'],
    ["echo 'é' | sha256sum", 'edd3a863872a04239eb29ad4bc12fc892b3d4ae57cc7e786a3697816f8e141c2  -'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('prints one line a FILE, and the tagged form with --tag', async () => {
    const s = await session(pipe);
    await s.run("printf 'abc' > abc.txt; printf '' > empty.txt");
    expect((await s.run('md5sum abc.txt empty.txt')).stdoutPlain).toBe('900150983cd24fb0d6963f7d28e17f72  abc.txt\nd41d8cd98f00b204e9800998ecf8427e  empty.txt');
    expect((await s.run('sha1sum --tag abc.txt')).stdoutPlain).toBe('SHA1 (abc.txt) = a9993e364706816aba3e25717850c26c9cd0d89d');
    expect((await s.run('md5sum -b abc.txt')).stdoutPlain).toBe('900150983cd24fb0d6963f7d28e17f72 *abc.txt');
    expect(await s.run('md5sum nope abc.txt')).toMatchObject({ status: 1, stderrPlain: 'md5sum: nope: No such file or directory' });
    s.stop();
  });

  it('checks a list with -c, saying which files match', async () => {
    const s = await session(pipe);
    await s.run("printf 'abc' > abc.txt; sha256sum abc.txt .profile > sums; md5sum --tag abc.txt > tagged");
    expect(await s.run('sha256sum -c sums')).toMatchObject({ status: 0, stdoutPlain: 'abc.txt: OK\n.profile: OK' });
    expect(await s.run('md5sum -c tagged')).toMatchObject({ status: 0, stdoutPlain: 'abc.txt: OK' });
    await s.run("printf 'abd' > abc.txt");
    expect(await s.run('sha256sum -c sums')).toMatchObject({
      status: 1,
      stdoutPlain: 'abc.txt: FAILED\n.profile: OK',
      stderrPlain: 'sha256sum: WARNING: 1 computed checksum did NOT match',
    });
    expect(await s.run('sha256sum -c --quiet sums')).toMatchObject({ status: 1, stdoutPlain: 'abc.txt: FAILED' });
    expect(await s.run('sha256sum -c --status sums')).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: '' });
    expect(await s.run('echo nonsense | sha256sum -c')).toMatchObject({ status: 1, stderrPlain: 'sha256sum: standard input: no properly formatted SHA256 checksum lines found' });
    s.stop();
  });

  it('says so when the page has no WebCrypto', async () => {
    const none: Digest = { hash: () => Promise.reject(new Error('WebCrypto is not available on this page (it needs https)')) };
    expect(await runLine('echo hi | sha256sum', { tty: false, digest: none })).toMatchObject({
      status: 1,
      stdoutPlain: '',
      stderrPlain: 'sha256sum: WebCrypto is not available on this page (it needs https)',
    });
    // md5sum needs no WebCrypto.
    expect(await runLine('echo hello | md5sum', { tty: false, digest: none })).toMatchObject({ status: 0, stdoutPlain: 'b1946ac92492d2347c6235b4d2611184  -' });
  });
});
