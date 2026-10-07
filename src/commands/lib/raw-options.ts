// getopt_long for a command that reads its own words (rawArgs) because a word that starts with a
// dash may be something other than an option: chmod's `-w` is a mode. Options and operands may be
// mixed, `--` ends the options, long options may be shortened while they stay unambiguous, and the
// mistakes are worded as getopt words them, ready for ctx.usage().

/** What an option sets: a key, and whether it takes a value. */
export type OptionDef = string | { readonly key: string; readonly value: true };

export interface OptionTable {
  readonly shorts: Readonly<Record<string, OptionDef>>;
  readonly longs: Readonly<Record<string, OptionDef>>;
  /** Letters that make a dash word an operand of its own (chmod's modes), rather than options. */
  readonly modeChars?: string;
}

export interface ReadOptions {
  readonly flags: Readonly<Record<string, string | true>>;
  readonly operands: readonly string[];
  /** Dash words made of `modeChars`, in order. */
  readonly modeWords: readonly string[];
}

const keyOf = (def: OptionDef): string => (typeof def === 'string' ? def : def.key);
const takesValue = (def: OptionDef): boolean => typeof def !== 'string';
const own = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** Reads `words` against `table`; `{ error }` holds getopt's message for a mistake. */
export function readOptions(words: readonly string[], table: OptionTable): ReadOptions | { readonly error: string } {
  const flags: Record<string, string | true> = {};
  const operands: string[] = [];
  const modeWords: string[] = [];
  let optionsOver = false;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (optionsOver || word === '-' || !word.startsWith('-')) {
      operands.push(word);
      continue;
    }
    if (word === '--') {
      optionsOver = true;
      continue;
    }
    if (word.startsWith('--')) {
      const body = word.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      const names = Object.keys(table.longs);
      const matches = own(table.longs, name) ? [name] : names.filter((long) => long.startsWith(name));
      // Shortened names that all mean the same option are not ambiguous: --qu and --quiet.
      const keys = new Set(matches.map((long) => keyOf(table.longs[long] ?? long)));
      if (matches.length === 0) return { error: `unrecognized option '--${name}'` };
      if (keys.size > 1) return { error: `option '--${name}' is ambiguous; possibilities: ${matches.map((long) => `'--${long}'`).join(' ')}` };
      const long = matches[0] ?? name;
      const def = table.longs[long] ?? long;
      if (takesValue(def)) {
        if (eq !== -1) flags[keyOf(def)] = body.slice(eq + 1);
        else if (i + 1 < words.length) {
          i += 1;
          flags[keyOf(def)] = words[i] ?? '';
        } else return { error: `option '--${long}' requires an argument` };
      } else {
        if (eq !== -1) return { error: `option '--${long}' doesn't allow an argument` };
        flags[keyOf(def)] = true;
      }
      continue;
    }
    for (let k = 1; k < word.length; k += 1) {
      const c = word.charAt(k);
      const def = own(table.shorts, c) ? table.shorts[c] : undefined;
      if (def !== undefined) {
        if (!takesValue(def)) {
          flags[keyOf(def)] = true;
          continue;
        }
        const rest = word.slice(k + 1);
        if (rest !== '') flags[keyOf(def)] = rest;
        else if (i + 1 < words.length) {
          i += 1;
          flags[keyOf(def)] = words[i] ?? '';
        } else return { error: `option requires an argument -- '${c}'` };
        break;
      }
      if (table.modeChars?.includes(c)) {
        modeWords.push(word);
        break;
      }
      return { error: `invalid option -- '${c}'` };
    }
  }
  return { flags, operands, modeWords };
}
