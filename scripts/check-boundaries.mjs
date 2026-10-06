#!/usr/bin/env node
// Enforces the module boundaries from docs/plan/02-architecture-and-contracts.md:
//   1. The DOM-free folders never reference browser globals or import Svelte, and import only
//      each other plus the service interfaces, so nothing reaches the DOM through an import.
//   2. No `{@html}` block appears anywhere: output renders through the output model, and legacy
//      HTML through the sanitising legacyHtml block in src/ui.
//   3. Nothing in src uses AbortSignal.any or AbortSignal.timeout, which Instagram's WKWebView
//      before iOS 17.4 lacks.
// Zero dependencies; run with `npm run check:boundaries`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Folders that must stay free of the DOM, browser storage and Svelte. src/content holds only the
 * owner's documents as text (imported with ?raw), so DOM-free code may import it.
 */
export const DOM_FREE_DIRS = ['src/shell', 'src/output', 'src/vfs', 'src/lib', 'src/commands', 'src/content'];

/**
 * Modules outside those folders that DOM-free code may import: the service contracts, which are
 * types, constants and pure functions only. They are held to the same rules as the folders.
 * The market contract is also bundled by the stock Worker (worker/stock).
 */
export const DOM_FREE_IMPORTABLE = ['src/services/types', 'src/services/storage-keys', 'src/services/market/contract'];

/** Browser globals the DOM-free folders may not reference. Services reach the browser for them. */
export const FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'globalThis',
  'self',
  'location',
  'matchMedia',
  'DOMParser',
  'fetch',
  'XMLHttpRequest',
  'indexedDB',
];

/** APIs no source file may use, with the reason. */
export const FORBIDDEN_APIS = [
  { pattern: /\bAbortSignal\s*\??\.\s*(?:any|timeout)\b/g, reason: "Instagram's WKWebView before iOS 17.4 lacks it; use combineSignals from services/net" },
];

/**
 * Finds `{@html` in any source file, test files included, so raw HTML never reaches the DOM.
 * @param {string} source
 * @returns {{ line: number, message: string }[]}
 */
export function findRawHtml(source) {
  return [...source.matchAll(/\{@html\b/g)].map((match) => ({
    line: lineAt(source, match.index),
    message: 'uses {@html}; render through the output model (or a legacyHtml block) instead',
  }));
}

const SOURCE_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs', '.svelte'];
const TEST_FILE = /\.test\.[cm]?[jt]s$/;

/**
 * Words after which a `/` starts a regular expression rather than a division.
 * @type {ReadonlySet<string>}
 */
const REGEX_PRECEDING_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Blanks out comments, and optionally the contents of string, template and regex
 * literals, keeping newlines so offsets still map to the same line numbers.
 * Template `${...}` expressions are kept, because they are code.
 * @param {string} source
 * @param {{ keepStrings: boolean }} options
 * @returns {string}
 */
export function maskSource(source, { keepStrings }) {
  let out = '';
  let i = 0;
  /** Brace depth of each open `${` inside a template literal. @type {number[]} */
  const templateStack = [];
  let braceDepth = 0;

  /** @param {string} text */
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  /** @param {string} text */
  const literal = (text) => (keepStrings ? text : blank(text));

  /** Reads a template literal body from `i` (just after a backtick or `}`) up to `${` or the closing backtick. */
  const readTemplateBody = () => {
    let start = i;
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
      } else if (c === '`') {
        out += literal(source.slice(start, i)) + '`';
        i += 1;
        return;
      } else if (c === '$' && source[i + 1] === '{') {
        out += literal(source.slice(start, i)) + '${';
        i += 2;
        templateStack.push(braceDepth);
        braceDepth = 0;
        return;
      } else {
        i += 1;
      }
    }
    out += literal(source.slice(start));
  };

  /** True when a `/` at the current position begins a regular expression literal. */
  const slashStartsRegex = () => {
    const before = out.replace(/\s+$/, '');
    if (before === '') return true;
    const last = before[before.length - 1] ?? '';
    if ('(,=:[!&|?{};+-*%<>~^'.includes(last)) return true;
    const word = /([A-Za-z_$][\w$]*)$/.exec(before);
    return word !== null && REGEX_PRECEDING_WORDS.has(word[1] ?? '');
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += c + literal(source.slice(i + 1, j)) + (source[j] === c ? c : '');
      i = source[j] === c ? j + 1 : j;
    } else if (c === '`') {
      out += '`';
      i += 1;
      readTemplateBody();
    } else if (c === '{') {
      braceDepth += 1;
      out += c;
      i += 1;
    } else if (c === '}') {
      if (braceDepth === 0 && templateStack.length > 0) {
        braceDepth = templateStack.pop() ?? 0;
        out += '}';
        i += 1;
        readTemplateBody();
      } else {
        braceDepth = Math.max(0, braceDepth - 1);
        out += c;
        i += 1;
      }
    } else if (c === '/' && slashStartsRegex()) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n') {
        const r = source[j];
        if (r === '\\') {
          j += 2;
          continue;
        }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        j += 1;
      }
      out += '/' + literal(source.slice(i + 1, j)) + (source[j] === '/' ? '/' : '');
      i = source[j] === '/' ? j + 1 : j;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * @param {string} text
 * @param {number} index
 */
function lineAt(text, index) {
  let line = 1;
  for (let k = 0; k < index; k += 1) if (text.charCodeAt(k) === 10) line += 1;
  return line;
}

/**
 * Names a file declares for itself, so a local `location` or `fetch` is not mistaken for the
 * browser global: declarations, destructuring declarations, imports, a first typed parameter and
 * a lone arrow parameter. Other parameters are not recognised; rename them if they clash.
 * @param {string} code source with comments and literals masked
 * @param {readonly string[]} names
 */
function declaredNames(code, names) {
  return new Set(
    names.filter((name) =>
      [
        `\\b(?:const|let|var|function|class)\\s+${name}\\b`,
        `\\b(?:const|let|var)\\s*[{[][^=;]*\\b${name}\\b[^=;]*=`,
        `\\bimport\\s+(?:type\\s+)?(?:${name}\\b|\\*\\s*as\\s+${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})`,
        `\\(\\s*${name}\\s*\\??:(?!:)`,
        `(?:^|[^\\w$.])${name}\\s*=>`,
      ].some((pattern) => new RegExp(pattern, 'm').test(code)),
    ),
  );
}

/**
 * Where a relative import lands, as a repo path without its extension, or null for a package.
 * @param {string} file repo path of the importing file, such as `src/shell/types.ts`
 * @param {string} specifier
 */
export function resolveImport(file, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const joined = specifier.startsWith('/') ? specifier.slice(1) : posix.join(posix.dirname(file), specifier);
  return posix.normalize(joined).replace(/\.(?:[cm]?[jt]s)$/, '').replace(/\/index$/, '');
}

/**
 * True when DOM-free code may import the module at `target` (a repo path from resolveImport).
 * @param {string} target
 */
function isDomFreeTarget(target) {
  return (
    DOM_FREE_DIRS.some((dir) => target === dir || target.startsWith(`${dir}/`)) ||
    DOM_FREE_IMPORTABLE.includes(target)
  );
}

/**
 * Finds browser globals and imports that leave the DOM-free folders in one DOM-free source file.
 * @param {string} source
 * @param {string} [file] the file's repo path; when given, relative imports are resolved and checked
 * @returns {{ line: number, message: string }[]}
 */
export function findBoundaryViolations(source, file) {
  /** @type {{ line: number, message: string }[]} */
  const problems = [];
  const code = maskSource(source, { keepStrings: false });
  const local = declaredNames(code, FORBIDDEN_GLOBALS);
  const globals = new RegExp(`(?<![\\w$.])(?:${FORBIDDEN_GLOBALS.join('|')})(?![\\w$])`, 'g');
  for (const match of code.matchAll(globals)) {
    const name = match[0];
    const after = code.slice(match.index + name.length);
    // An object key or a property signature (`{ location: ... }`) names a property, not the global.
    const isKey = /^\s*\??:(?!:)/.test(after);
    if (local.has(name) || isKey) continue;
    problems.push({ line: lineAt(code, match.index), message: `references \`${name}\`` });
  }

  const withStrings = maskSource(source, { keepStrings: true });
  const imports = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  for (const match of withStrings.matchAll(imports)) {
    const specifier = match[2] ?? '';
    const line = lineAt(withStrings, match.index);
    const isSvelte =
      specifier === 'svelte' || specifier.startsWith('svelte/') || /\.svelte(?:\.[jt]s)?$/.test(specifier);
    if (isSvelte) {
      problems.push({ line, message: `imports '${specifier}'` });
      continue;
    }
    const target = file ? resolveImport(file, specifier) : null;
    if (target !== null && !isDomFreeTarget(target)) {
      problems.push({
        line,
        message: `imports '${specifier}' (${target}); DOM-free code may import only ${DOM_FREE_DIRS.join(', ')} and ${DOM_FREE_IMPORTABLE.join(', ')}`,
      });
    }
  }
  return problems.sort((a, b) => a.line - b.line);
}

/**
 * Finds uses of FORBIDDEN_APIS in any source file.
 * @param {string} source
 * @returns {{ line: number, message: string }[]}
 */
export function findForbiddenApis(source) {
  const code = maskSource(source, { keepStrings: false });
  return FORBIDDEN_APIS.flatMap(({ pattern, reason }) =>
    [...code.matchAll(pattern)].map((match) => ({
      line: lineAt(code, match.index),
      message: `uses ${match[0].replace(/\s+/g, '')}: ${reason}`,
    })),
  );
}

/**
 * Lists every source file under a folder; a missing folder yields nothing.
 * @param {string} dir absolute path
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

/** @param {string} path */
const toRepoPath = (path) => relative(ROOT, path).split(sep).join('/');

function main() {
  /** @type {string[]} */
  const failures = [];

  let scanned = 0;
  for (const module of DOM_FREE_IMPORTABLE) {
    const repoPath = `${module}.ts`;
    let source;
    try {
      source = readFileSync(join(ROOT, repoPath), 'utf8');
    } catch {
      failures.push(`${repoPath}:1 is listed in DOM_FREE_IMPORTABLE but does not exist`);
      continue;
    }
    scanned += 1;
    for (const problem of findBoundaryViolations(source, repoPath)) {
      failures.push(`${repoPath}:${problem.line} ${problem.message}`);
    }
  }
  for (const dir of DOM_FREE_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      if (TEST_FILE.test(file)) continue;
      scanned += 1;
      const repoPath = toRepoPath(file);
      if (file.endsWith('.svelte')) {
        failures.push(`${repoPath}:1 is a Svelte component inside a DOM-free folder`);
        continue;
      }
      if (/\.svelte\.[cm]?[jt]s$/.test(file)) {
        failures.push(`${repoPath}:1 is a Svelte rune module inside a DOM-free folder`);
        continue;
      }
      for (const problem of findBoundaryViolations(readFileSync(file, 'utf8'), repoPath)) {
        failures.push(`${repoPath}:${problem.line} ${problem.message}`);
      }
    }
  }

  for (const file of walk(join(ROOT, 'src'))) {
    const repoPath = toRepoPath(file);
    const source = readFileSync(file, 'utf8');
    if (!TEST_FILE.test(file)) {
      for (const problem of findForbiddenApis(source)) failures.push(`${repoPath}:${problem.line} ${problem.message}`);
    }
    for (const problem of findRawHtml(source)) failures.push(`${repoPath}:${problem.line} ${problem.message}`);
  }

  if (failures.length > 0) {
    console.error(`check-boundaries: ${failures.length} problem(s)\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(`\nDOM-free folders: ${DOM_FREE_DIRS.join(', ')}`);
    process.exit(1);
  }
  console.log(`check-boundaries: ok (${scanned} DOM-free file(s) scanned, no {@html} anywhere)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
