import { describe, expect, it } from 'vitest';
import { unescape } from './escapes';
import { classifySuffix, colourFor, fileType, humanSize, kibBlocks, localTime, lsDate, modeString, quoteName, statDate } from './listing';
import { parseMode } from './mode';

describe('modeString', () => {
  it('writes the type and permission bits as ls -l does', () => {
    expect(modeString({ type: 'directory', mode: 0o755 })).toBe('drwxr-xr-x');
    expect(modeString({ type: 'file', mode: 0o644 })).toBe('-rw-r--r--');
    expect(modeString({ type: 'file', mode: 0o600 })).toBe('-rw-------');
    expect(modeString({ type: 'symlink', mode: 0o777 })).toBe('lrwxrwxrwx');
    expect(modeString({ type: 'device', mode: 0o666 })).toBe('crw-rw-rw-');
  });

  it('shows the sticky, setuid and setgid bits, upper case when execute is off', () => {
    expect(modeString({ type: 'directory', mode: 0o1777 })).toBe('drwxrwxrwt');
    expect(modeString({ type: 'directory', mode: 0o1770 })).toBe('drwxrwx--T');
    expect(modeString({ type: 'file', mode: 0o4755 })).toBe('-rwsr-xr-x');
    expect(modeString({ type: 'file', mode: 0o2644 })).toBe('-rw-r-Sr--');
  });
});

describe('sizes', () => {
  it('rounds up to one decimal below 10, as ls -h does', () => {
    expect(humanSize(0)).toBe('0');
    expect(humanSize(1023)).toBe('1023');
    expect(humanSize(1024)).toBe('1.0K');
    expect(humanSize(1100)).toBe('1.1K');
    expect(humanSize(4096)).toBe('4.0K');
    expect(humanSize(15_000)).toBe('15K');
    expect(humanSize(10_239)).toBe('10K');
    expect(humanSize(1024 * 1024 * 1.5)).toBe('1.5M');
  });

  it('counts 4 KiB blocks, as the total line does', () => {
    expect(kibBlocks({ type: 'file', size: 0 })).toBe(0);
    expect(kibBlocks({ type: 'file', size: 1 })).toBe(4);
    expect(kibBlocks({ type: 'file', size: 4097 })).toBe(8);
    expect(kibBlocks({ type: 'directory', size: 4096 })).toBe(4);
    expect(kibBlocks({ type: 'symlink', size: 5 })).toBe(0);
  });

  it('names file types as stat does', () => {
    expect(fileType({ type: 'file', size: 0 })).toBe('regular empty file');
    expect(fileType({ type: 'file', size: 3 })).toBe('regular file');
    expect(fileType({ type: 'device', size: 0 })).toBe('character special file');
  });
});

describe('times', () => {
  const at = Date.UTC(2026, 9, 6, 0, 0, 0);

  it('reads a wall clock and its offset in a time zone, daylight saving included', () => {
    expect(localTime(at, 'Australia/Sydney')).toEqual({ year: 2026, month: 10, day: 6, hour: 11, minute: 0, second: 0, offset: 660 });
    expect(localTime(Date.UTC(2026, 5, 1, 0, 0, 0), 'Australia/Sydney').offset).toBe(600);
    expect(localTime(at, 'UTC').offset).toBe(0);
    expect(localTime(at, 'America/New_York')).toMatchObject({ day: 5, hour: 20, offset: -240 });
    // An unknown zone is UTC, as glibc has it.
    expect(localTime(at, 'Nowhere/Special').offset).toBe(0);
  });

  it("writes ls -l's two date styles: the time when recent, the year when not", () => {
    expect(lsDate(at, at + 3_600_000, 'UTC')).toBe('Oct  6 00:00');
    expect(lsDate(at, at + 200 * 86_400_000, 'UTC')).toBe('Oct  6  2026');
    // In the future, the year too.
    expect(lsDate(at + 86_400_000 * 30, at, 'UTC')).toBe('Nov  5  2026');
  });

  it("writes stat's full date with nanoseconds and the offset", () => {
    expect(statDate(at + 250, 'Australia/Sydney')).toBe('2026-10-06 11:00:00.250000000 +1100');
    expect(statDate(at, 'America/New_York')).toBe('2026-10-05 20:00:00.000000000 -0400');
  });
});

describe('colours and indicators', () => {
  it('colours by kind in theme tokens', () => {
    expect(colourFor({ type: 'directory', mode: 0o755 }, 'docs')).toEqual({ fg: 'link', bold: true });
    expect(colourFor({ type: 'symlink', mode: 0o777 }, 'user')).toEqual({ fg: 'accent', bold: true });
    expect(colourFor({ type: 'symlink', mode: 0o777 }, 'gone', true)).toEqual({ fg: 'error', bold: true });
    expect(colourFor({ type: 'file', mode: 0o755 }, 'deploy')).toEqual({ fg: 'ok', bold: true });
    expect(colourFor({ type: 'file', mode: 0o644 }, 'software.tar.gz')).toEqual({ fg: 'red', bold: true });
    expect(colourFor({ type: 'file', mode: 0o644 }, 'vacation.JPG')).toEqual({ fg: 'purple', bold: true });
    expect(colourFor({ type: 'file', mode: 0o644 }, 'playlist.m3u')).toEqual({ fg: 'cyan' });
    expect(colourFor({ type: 'file', mode: 0o644 }, 'README.md')).toEqual({ fg: 'fg-strong' });
    expect(colourFor({ type: 'device', mode: 0o666 }, 'null')).toEqual({ fg: 'warn', bold: true });
  });

  it('marks folders, programs and links for -F, and only folders for -p', () => {
    expect(classifySuffix({ type: 'directory', mode: 0o755 }, false)).toBe('/');
    expect(classifySuffix({ type: 'file', mode: 0o755 }, false)).toBe('*');
    expect(classifySuffix({ type: 'symlink', mode: 0o777 }, false)).toBe('@');
    expect(classifySuffix({ type: 'file', mode: 0o644 }, false)).toBe('');
    expect(classifySuffix({ type: 'file', mode: 0o755 }, true)).toBe('');
    expect(classifySuffix({ type: 'directory', mode: 0o755 }, true)).toBe('/');
  });
});

describe('quoteName', () => {
  it('leaves names the shell reads back unchanged alone, and quotes the rest', () => {
    expect(quoteName('README.md')).toBe('README.md');
    expect(quoteName('café-notes_2.txt')).toBe('café-notes_2.txt');
    expect(quoteName('my file')).toBe("'my file'");
    expect(quoteName("it's")).toBe('"it\'s"');
    expect(quoteName('a$b')).toBe("'a$b'");
    expect(quoteName("it's $5")).toBe(`'it'\\''s $5'`);
    expect(quoteName('<b>x</b>')).toBe("'<b>x</b>'");
    expect(quoteName('line\nbreak')).toBe("$'line\\nbreak'");
    expect(quoteName('bell\u0007')).toBe("$'bell\\007'");
  });
});

describe('escapes', () => {
  it('reads the echo -e set, with \\c stopping everything', () => {
    expect(unescape('a\\tb\\nc\\\\d')).toEqual({ text: 'a\tb\nc\\d', stop: false });
    expect(unescape('\\e[31mred')).toEqual({ text: '\u001b[31mred', stop: false });
    expect(unescape('\\0101\\x42\\x4')).toEqual({ text: 'AB\u0004', stop: false });
    expect(unescape('keep\\q and \\')).toEqual({ text: 'keep\\q and \\', stop: false });
    expect(unescape('stop\\chere')).toEqual({ text: 'stop', stop: true });
  });

  it("reads printf's own forms in a format: \\NNN, \\u and \\\"", () => {
    expect(unescape('\\101\\"\\u00e9', 'format')).toEqual({ text: 'A"é', stop: false });
    // \0NNN is echo's; in a format \0 is the NUL byte.
    expect(unescape('\\0', 'format').text).toBe('\u0000');
  });
});

describe('parseMode', () => {
  it('reads octal modes', () => {
    expect(parseMode('700', 0o755, true)).toBe(0o700);
    expect(parseMode('1777', 0o755, true)).toBe(0o1777);
    expect(parseMode('8', 0o755, true)).toBeNull();
  });

  it('applies symbolic clauses to the mode a file has', () => {
    expect(parseMode('u+x', 0o644, false)).toBe(0o744);
    expect(parseMode('go-w', 0o666, false)).toBe(0o644);
    expect(parseMode('u=rwx,go=', 0o755, true)).toBe(0o700);
    expect(parseMode('a+X', 0o644, false)).toBe(0o644);
    expect(parseMode('a+X', 0o644, true)).toBe(0o755);
    expect(parseMode('+t', 0o777, true)).toBe(0o1777);
    expect(parseMode('u+s', 0o755, false)).toBe(0o4755);
    expect(parseMode('u+r-w', 0o644, false)).toBe(0o444);
    expect(parseMode('x+y', 0o644, false)).toBeNull();
    expect(parseMode('', 0o644, false)).toBeNull();
  });
});
