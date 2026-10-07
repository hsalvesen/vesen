// The body of file; its spec, in file.ts, loads this the first time file runs.
//
// What a file is comes from what it holds, as file(1)'s magic tests read it: the first bytes of a
// picture or an archive, a #! line, JSON that parses, an #include, then the text's encoding and
// line endings. The seed's pictures, videos and archives hold a line of text standing in for their
// bytes, which a browser's file system cannot keep, so for those names alone the type comes from
// the name.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import type { Stat } from '../../../vfs/types';
import { errorCode, reason } from '../../lib/files';
import { DEVICE_NUMBERS } from '../../lib/listing';

/** What --help, help and man say about file, besides its spec (file.ts). */
export const doc: CommandDoc = {
  description:
    "Says what kind of thing each FILE is: a folder, a link and where it points, an empty file, or what the content is (ASCII or UTF-8 text, a script and its interpreter, JSON, HTML, C source, Markdown, a picture or an archive), with how its lines end. A FILE that cannot be opened is reported in the output, as file does, and the status stays 0.",
  man: [
    {
      heading: 'NOTES',
      body: 'The pictures, videos and archives in the seed hold a line of text standing in for their bytes; file names their type from their name, as it would from the real bytes. A file you write is judged by what you wrote.',
    },
    { heading: 'EXIT STATUS', body: '0, even for a FILE that cannot be opened, as file(1) has it; 1 when no FILE is given.' },
  ],
};

interface Kind {
  readonly desc: string;
  readonly mime: string;
  readonly charset: string;
}

const kind = (desc: string, mime: string, charset = 'binary'): Kind => ({ desc, mime, charset });

/** The first bytes of the formats a text can carry them in. */
const MAGIC: readonly (readonly [string, Kind])[] = [
  ['\u0089PNG\r\n\u001a\n', kind('PNG image data', 'image/png')],
  ['GIF87a', kind('GIF image data, version 87a', 'image/gif')],
  ['GIF89a', kind('GIF image data, version 89a', 'image/gif')],
  ['ÿØÿ', kind('JPEG image data', 'image/jpeg')],
  ['PK\u0003\u0004', kind('Zip archive data', 'application/zip')],
  ['\u001f\u008b', kind('gzip compressed data', 'application/gzip')],
  ['\u007fELF', kind('ELF executable', 'application/x-executable')],
];

/** What the seed's stand-ins are, by extension. */
const STAND_INS: Readonly<Record<string, Kind>> = {
  jpg: kind('JPEG image data, JFIF standard 1.01', 'image/jpeg'),
  jpeg: kind('JPEG image data, JFIF standard 1.01', 'image/jpeg'),
  png: kind('PNG image data', 'image/png'),
  gif: kind('GIF image data, version 89a', 'image/gif'),
  webp: kind('RIFF (little-endian) data, Web/P image', 'image/webp'),
  mp4: kind('ISO Media, MP4 v2 [ISO 14496-14]', 'video/mp4'),
  mp3: kind('Audio file with ID3 version 2.4.0', 'audio/mpeg'),
  gz: kind('gzip compressed data, from Unix', 'application/gzip'),
  tgz: kind('gzip compressed data, from Unix', 'application/gzip'),
  zip: kind('Zip archive data, at least v2.0 to extract', 'application/zip'),
  pdf: kind('PDF document, version 1.7', 'application/pdf'),
};

/** Interpreters a #! line may name, and what file calls a script for each. */
const INTERPRETERS: readonly (readonly [RegExp, string, string])[] = [
  [/^(?:sh|dash|ash)$/, 'POSIX shell script', 'text/x-shellscript'],
  [/^bash$/, 'Bourne-Again shell script', 'text/x-shellscript'],
  [/^zsh$/, "Paul Falstad's zsh script", 'text/x-shellscript'],
  // vesen's login shell, /bin/vesh: the seed's programs and scripts start with it.
  [/^vesh$/, 'vesh shell script', 'text/x-shellscript'],
  [/^python[\d.]*$/, 'Python script', 'text/x-script.python'],
  [/^perl$/, 'Perl script', 'text/x-perl'],
  [/^node(?:js)?$/, 'Node.js script', 'application/javascript'],
  [/^ruby$/, 'Ruby script', 'text/x-ruby'],
];

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** ASCII text, or UTF-8 text, with what its lines are like. */
function textKind(content: string): { encoding: string; charset: string; notes: string } {
  const ascii = !/[^\u0000-\u007f]/.test(content);
  // A loop, not Math.max(...lines): a file may have more lines than a call takes arguments.
  let longest = 0;
  for (const line of content.split('\n')) longest = Math.max(longest, line.length);
  const notes: string[] = [];
  if (longest > 300) notes.push(`with very long lines (${longest})`);
  if (content.includes('\r\n')) notes.push('with CRLF line terminators');
  else if (!content.includes('\n')) notes.push('with no line terminators');
  if (content.includes('\u001b')) notes.push('with escape sequences');
  return {
    encoding: ascii ? 'ASCII text' : 'Unicode text, UTF-8 text',
    charset: ascii ? 'us-ascii' : 'utf-8',
    notes: notes.map((note) => `, ${note}`).join(''),
  };
}

/** What a regular file holds. */
function contentKind(ctx: CommandContext, path: string, content: string): Kind {
  for (const [magic, found] of MAGIC) if (content.startsWith(magic)) return found;
  if (content.startsWith('%PDF-')) return kind(`PDF document, version ${/^%PDF-(\d+\.\d+)/.exec(content)?.[1] ?? '1.4'}`, 'application/pdf');
  const ext = extension(path);
  const standIn = STAND_INS[ext];
  if (standIn !== undefined && !content.includes('\n') && content.length < 64 && ctx.fs.seeded?.(path) === true) return standIn;
  // Control characters other than the ones text uses make it data.
  if (/[\u0000-\u0006\u000e-\u001a\u001c-\u001f\u007f]/.test(content)) return kind('data', 'application/octet-stream');
  const text = textKind(content);
  const as = (what: string, mime: string, executable = false): Kind =>
    kind(`${what}, ${text.encoding}${executable ? ' executable' : ''}${text.notes}`, mime, text.charset);
  if (content.startsWith('#!')) {
    const line = (content.split('\n')[0] ?? '').slice(2).trim();
    const words = line.split(/\s+/);
    const program = words[0]?.endsWith('/env') ? (words[1] ?? '') : (words[0] ?? '');
    const name = program.slice(program.lastIndexOf('/') + 1);
    const known = INTERPRETERS.find(([pattern]) => pattern.test(name));
    if (known !== undefined) return as(known[1], known[2], true);
    return as(`a ${line} script`, 'text/plain', true);
  }
  const trimmed = content.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && isJson(trimmed)) return kind('JSON text data', 'application/json', text.charset);
  if (/^\s*<!doctype html/i.test(content) || /^\s*<html[\s>]/i.test(content)) return as('HTML document', 'text/html');
  if (content.startsWith('<?xml')) return as('XML 1.0 document', 'text/xml');
  if (/^\s*<svg[\s>]/.test(content)) return kind('SVG Scalable Vector Graphics image', 'image/svg+xml', text.charset);
  if (content.startsWith('#EXTM3U')) return as('M3U playlist', 'audio/x-mpegurl');
  // Spaces and tabs, not \s: with /m, a \s* could run on through every blank line from each line's
  // start, and a file of blank lines would take minutes.
  if (/^[ \t]*#[ \t]*include[ \t]*[<"]/m.test(content) || ext === 'c' || ext === 'h') return as('C source', 'text/x-c');
  if (ext === 'md' || ext === 'markdown') return as('Markdown document', 'text/markdown');
  if (ext === 'js' || ext === 'mjs') return as('JavaScript source', 'text/javascript');
  if (ext === 'py') return as('Python script', 'text/x-script.python');
  return kind(`${text.encoding}${text.notes}`, 'text/plain', text.charset);
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** What `typed` is; a missing FILE is a description too, as file prints it. */
function describe(ctx: CommandContext, typed: string, follow: boolean): Kind {
  const path = ctx.resolve(typed);
  let stat: Stat;
  try {
    stat = follow ? ctx.fs.stat(path) : ctx.fs.lstat(path);
  } catch (error) {
    const message = `cannot open \`${typed}' (${reason(error)})`;
    return kind(message, message, '');
  }
  switch (stat.type) {
    case 'symlink': {
      const target = ctx.fs.readlink(path);
      return kind(`${ctx.fs.exists(path) ? '' : 'broken '}symbolic link to ${target}`, 'inode/symlink');
    }
    case 'directory':
      return kind(`${stat.mode & 0o1000 ? 'sticky, ' : ''}directory`, 'inode/directory');
    case 'device': {
      const numbers = DEVICE_NUMBERS[path.slice(path.lastIndexOf('/') + 1)] ?? [0, 0];
      return kind(`character special (${numbers[0]}/${numbers[1]})`, 'inode/chardevice');
    }
    case 'file':
      break;
  }
  if (stat.size === 0) return kind('empty', 'inode/x-empty');
  let content: string;
  try {
    content = ctx.fs.readFile(path);
  } catch (error) {
    if (errorCode(error) === 'EACCES') return kind('regular file, no read permission', 'regular file, no read permission', '');
    const message = `cannot open \`${typed}' (${reason(error)})`;
    return kind(message, message, '');
  }
  return contentKind(ctx, path, content);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) {
    await ctx.stderr.write('Usage: file [-bhiL] [--mime-type] FILE...\n');
    return ctx.usage();
  }
  const follow = ctx.opts.dereference === true && ctx.opts['no-dereference'] !== true;
  const brief = ctx.opts.brief === true;
  const mimeType = ctx.opts['mime-type'] === true;
  const mime = ctx.opts.mime === true || mimeType;
  const width = Math.max(...ctx.args.map((typed) => typed.length));
  for (const typed of ctx.args) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    const found = describe(ctx, typed, follow);
    const what = !mime ? found.desc : mimeType || found.charset === '' ? found.mime : `${found.mime}; charset=${found.charset}`;
    await ctx.stdout.write(brief ? `${what}\n` : `${typed}:${' '.repeat(width - typed.length)} ${what}\n`);
  }
  return 0;
}
