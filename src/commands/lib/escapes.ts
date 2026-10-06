// Backslash escapes, as echo -e and printf read them (GNU coreutils' echo.c and printf.c):
//
//   \\ \a \b \e \f \n \r \t \v      the usual characters (\e is ESC, for SGR colours)
//   \c                              stop: nothing more is printed, not even the newline
//   \0NNN (echo, printf's %b)       the character with octal value NNN, up to three digits
//   \NNN (printf's format)          the same, without the 0
//   \xHH                            the character with hex value HH, one or two digits
//   \uHHHH \UHHHHHHHH (printf)      a Unicode code point
//   \" (printf's format)            a double quote
//
// Anything else after a backslash is printed with its backslash, as GNU does.

const SIMPLE: Readonly<Record<string, string>> = {
  '\\': '\\',
  a: '\u0007',
  b: '\b',
  e: '\u001b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

export interface Unescaped {
  readonly text: string;
  /** \c was read: the caller prints nothing after `text`. */
  readonly stop: boolean;
}

export type EscapeDialect = 'echo' | 'format';

function readDigits(text: string, from: number, pattern: RegExp, max: number): string {
  let digits = '';
  while (digits.length < max && from + digits.length < text.length && pattern.test(text.charAt(from + digits.length))) {
    digits += text.charAt(from + digits.length);
  }
  return digits;
}

function codePoint(value: number): string {
  return value <= 0x10ffff ? String.fromCodePoint(value) : '�';
}

/**
 * Reads the escape at `text[at]` (a backslash). Returns what it stands for and the index after
 * it, or null for \c.
 */
export function readEscape(text: string, at: number, dialect: EscapeDialect): { value: string; next: number } | null {
  const c = text.charAt(at + 1);
  if (c === '') return { value: '\\', next: at + 1 };
  if (c === 'c') return null;
  const simple = SIMPLE[c];
  if (simple !== undefined) return { value: simple, next: at + 2 };
  if (dialect === 'format' && c === '"') return { value: '"', next: at + 2 };
  if (c === 'x') {
    const hex = readDigits(text, at + 2, /[0-9a-fA-F]/, 2);
    if (hex === '') return { value: '\\x', next: at + 2 };
    return { value: String.fromCharCode(parseInt(hex, 16)), next: at + 2 + hex.length };
  }
  if (dialect === 'echo' && c === '0') {
    const octal = readDigits(text, at + 2, /[0-7]/, 3);
    return { value: String.fromCharCode(parseInt(octal || '0', 8) & 0xff), next: at + 2 + octal.length };
  }
  if (dialect === 'format' && /[0-7]/.test(c)) {
    const octal = readDigits(text, at + 1, /[0-7]/, 3);
    return { value: String.fromCharCode(parseInt(octal, 8) & 0xff), next: at + 1 + octal.length };
  }
  if (dialect === 'format' && (c === 'u' || c === 'U')) {
    const hex = readDigits(text, at + 2, /[0-9a-fA-F]/, c === 'u' ? 4 : 8);
    if (hex === '') return { value: `\\${c}`, next: at + 2 };
    return { value: codePoint(parseInt(hex, 16)), next: at + 2 + hex.length };
  }
  return { value: `\\${c}`, next: at + 2 };
}

/** Interprets every escape in `text`: echo -e, and printf's %b. */
export function unescape(text: string, dialect: EscapeDialect = 'echo'): Unescaped {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const backslash = text.indexOf('\\', i);
    if (backslash === -1) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, backslash);
    const read = readEscape(text, backslash, dialect);
    if (read === null) return { text: result, stop: true };
    result += read.value;
    i = read.next;
  }
  return { text: result, stop: false };
}
