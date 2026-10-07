// Which web link a word names, for open and xdg-open.

import { safeHref } from '../../output/model';

/** The first operand of a command's words: after the name, skipping flags until `--`. */
export function firstOperand(argv: readonly string[]): string | undefined {
  let flags = true;
  for (const word of argv.slice(1)) {
    if (flags && word === '--') {
      flags = false;
      continue;
    }
    if (flags && word.startsWith('-') && word !== '-') continue;
    return word;
  }
  return undefined;
}

/** A bare host with an optional port and path, such as `vesen.app/x`, taken as https. */
const BARE_HOST = /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]\S*)?$/;

/** The URL a word names: an http, https or mailto URL, or a bare host as https; otherwise null. */
export function webUrl(word: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(word)) return safeHref(word);
  return BARE_HOST.test(word) ? safeHref(`https://${word}`) : null;
}

/**
 * The URL a desktop browser opens inside the gesture: only one written as a web address
 * (`https://…`, `http://…` or `www.…`), never a bare name that might be a file, such as README.md.
 */
export function autoOpenUrl(argv: readonly string[]): string | null {
  const word = firstOperand(argv);
  if (word === undefined || !/^(?:https?:\/\/|www\.)/i.test(word)) return null;
  return webUrl(word);
}
