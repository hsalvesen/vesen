// File modes as chmod(1) and mkdir -m read them: octal (755, 1777) or symbolic clauses such as
// u+x, go-w, a=rX, u=rwx,g=rx,o= (GNU's grammar, without the umask subtleties).

const WHO: Readonly<Record<string, number>> = { u: 0o4700, g: 0o2070, o: 0o1007, a: 0o7777 };

/**
 * The mode `text` gives a file whose mode is now `base`; null when it is not a mode. `directory`
 * matters for X, which adds execute to folders and to files someone may already execute.
 */
export function parseMode(text: string, base: number, directory: boolean): number | null {
  if (/^[0-7]{1,4}$/.test(text)) return parseInt(text, 8);
  let mode = base & 0o7777;
  for (const clause of text.split(',')) {
    const match = /^([ugoa]*)((?:[-+=][rwxXst]*)+)$/.exec(clause);
    if (match === null) return null;
    const who = match[1] === '' ? 'a' : (match[1] ?? 'a');
    const mask = [...who].reduce((bits, letter) => bits | (WHO[letter] ?? 0), 0);
    for (const action of (match[2] ?? '').match(/[-+=][rwxXst]*/g) ?? []) {
      const op = action.charAt(0);
      let bits = 0;
      for (const perm of action.slice(1)) {
        if (perm === 'r') bits |= 0o444;
        else if (perm === 'w') bits |= 0o222;
        else if (perm === 'x') bits |= 0o111;
        else if (perm === 'X') bits |= directory || (mode & 0o111) !== 0 ? 0o111 : 0;
        else if (perm === 's') bits |= 0o6000;
        else if (perm === 't') bits |= 0o1000;
      }
      bits &= mask;
      if (op === '+') mode |= bits;
      else if (op === '-') mode &= ~bits;
      else mode = (mode & ~(mask & 0o0777)) | bits;
    }
  }
  return mode & 0o7777;
}
