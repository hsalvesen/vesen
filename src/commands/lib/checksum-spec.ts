// The spec md5sum, sha1sum, sha256sum and sha512sum share. Kept apart from their body
// (lib/checksum.ts), so the catalogue's chunk carries only this.

import { defineCommand, type CommandSpec, type LoadFn } from '../../shell/types';

export function checksumSpec(name: string, label: string, bits: number, load: LoadFn): CommandSpec {
  return defineCommand({
    name,
    category: 'text',
    summary: `compute and check ${label} message digest`,
    synopsis: [`${name} [OPTION]... [FILE]...`],
    flags: [
      { short: 'b', long: 'binary', description: 'read in binary mode (marks the name with *)' },
      { short: 'c', long: 'check', description: 'read checksums from the FILEs and check them' },
      { long: 'tag', description: 'print ALGORITHM (FILE) = CHECKSUM lines instead' },
      { short: 't', long: 'text', description: 'read in text mode (the default)' },
      { long: 'quiet', description: "with --check, don't print OK for each verified file" },
      { long: 'status', description: "with --check, don't output anything; the status shows success" },
    ],
    args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
    examples: [
      { line: `echo hello | ${name}`, note: `the ${bits}-bit checksum of hello and a new line`, offline: true },
      { line: `${name} .bashrc .profile`, note: 'one line a file', offline: true },
      { line: `${name} .profile > sums; ${name} -c sums`, note: 'record, then check', offline: true },
    ],
    seeAlso: ['md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'base64'].filter((other) => other !== name),
    load,
  });
}
