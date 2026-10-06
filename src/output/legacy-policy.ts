// What the legacy HTML shim lets through. Legacy commands still return HTML strings until they
// are ported; ui/legacy-html.ts rebuilds that HTML from scratch, keeping only what is listed here.
// This file is the policy and stays DOM-free so it can be tested on its own.

import { safeHref } from './model';

/** Elements that are rebuilt. Any other element is unwrapped: its children are kept, the tag is not. */
export const LEGACY_TAGS: ReadonlySet<string> = new Set([
  'span', 'div', 'pre', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'p', 'code',
]);

/** Elements dropped together with everything inside them: script, embedded documents and foreign content. */
export const LEGACY_DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'svg', 'math', 'title', 'textarea', 'xmp', 'noembed', 'noframes', 'plaintext', 'select', 'head',
  'audio', 'video', 'canvas', 'link', 'meta', 'base',
]);

/**
 * Every class name legacy command output uses: the theme and cathode lists, fastfetch's
 * "WM Theme" value, the highlight the stores toggle on them, the art classes (the banner,
 * logos, colour blocks, charts and QR codes, and a fallback glyph held to one cell) with their
 * screen-reader text, and the output
 * components in styles/components.css (role colours, errors, panels and their tones, swatches,
 * and the banner's keyboard hint).
 */
export const LEGACY_CLASSES: ReadonlySet<string> = new Set([
  'theme-name', 'cathode-name', 'current-theme-name', 'is-current', 'art', 'art-fit', 'art-cell', 'sr-only',
  'out-strong', 'out-accent', 'out-muted', 'out-error',
  'out-panel', 'out-panel-title', 'tone-warn', 'tone-ok', 'tone-error', 'tone-link', 'tone-muted',
  'swatches', 'keys-hint',
]);

/** Attributes kept besides style, class and href, with the values they may hold. */
const DATA_ATTRIBUTES: ReadonlySet<string> = new Set(['data-theme-name', 'data-cathode-name']);
const DATA_VALUE = /^[a-z0-9 _-]{1,64}$/i;

/**
 * No `position`, `inset`, `z-index` or `transform`: output stays in the flow, so it cannot be
 * laid over the prompt. ui/OutputView.svelte also gives each legacy output `contain: paint`, so
 * what padding and negative margins can do is drawn, and hit, only inside that output's own box.
 */
const STYLE_PROPERTIES: ReadonlySet<string> = new Set([
  'color', 'background', 'background-color', 'font-weight', 'font-style', 'font-size', 'font-family',
  'text-decoration', 'white-space', 'display', 'flex', 'flex-direction', 'flex-wrap', 'flex-shrink',
  'flex-grow', 'gap', 'align-items', 'justify-content', 'width', 'min-width', 'max-width', 'border-left',
  'border-radius', 'opacity', 'line-height', 'letter-spacing', 'overflow-x',
  'overflow-wrap', 'word-wrap', 'word-break', 'vertical-align',
]);
const BOX_PROPERTY = /^(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/;

/**
 * CSS functions a value may call; '' is a bare parenthesis inside calc(). Anything else, url()
 * and image-set() included, drops the declaration.
 */
const STYLE_FUNCTIONS: ReadonlySet<string> = new Set(['', 'var', 'rgb', 'rgba', 'hsl', 'hsla', 'calc', 'min', 'max', 'clamp']);

// Plain tokens only: no quotes, backslashes, colons, semicolons, braces, angle brackets or at-signs.
const VALUE_CHARACTERS = /^[\w #%.,()+*/-]+$/;
const FORBIDDEN_IN_VALUE = /url\(|expression|javascript:|\\|\/\*|\*\//i;

export function isLegacyStyleProperty(name: string): boolean {
  return STYLE_PROPERTIES.has(name) || BOX_PROPERTY.test(name);
}

/** The value a declaration may keep, or null when the declaration must go. */
function styleValue(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '' || !VALUE_CHARACTERS.test(value) || FORBIDDEN_IN_VALUE.test(value)) return null;
  for (const call of value.matchAll(/([\w-]*)\(/g)) {
    if (!STYLE_FUNCTIONS.has((call[1] ?? '').toLowerCase())) return null;
  }
  return value;
}

/** Splits a declaration list on semicolons that are outside quotes and parentheses. */
function splitDeclarations(style: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < style.length; i += 1) {
    const c = style[i];
    if (quote !== null) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
    } else if (c === ';' && depth === 0) {
      parts.push(style.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(style.slice(start));
  return parts;
}

/**
 * Re-parses a style attribute and keeps only allowlisted properties with plain values.
 * Returns the rebuilt declarations, or '' when nothing survives.
 */
export function filterLegacyStyle(style: string): string {
  const kept: string[] = [];
  for (const declaration of splitDeclarations(style)) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    if (!isLegacyStyleProperty(property)) continue;
    const value = styleValue(declaration.slice(colon + 1));
    if (value !== null) kept.push(`${property}: ${value}`);
  }
  return kept.join('; ');
}

/** Keeps only the class names in LEGACY_CLASSES; '' when none remain. */
export function filterLegacyClasses(value: string): string {
  return value
    .split(/\s+/)
    .filter((name) => LEGACY_CLASSES.has(name))
    .join(' ');
}

/** An http, https or mailto href, normalised; anything else is null. */
export function legacyHref(value: string): string | null {
  return safeHref(value);
}

/**
 * The value an attribute keeps on a rebuilt element, or null when it is dropped. `href` is
 * handled by `legacyHref`, and `target` and `rel` are set by the renderer, so both are null here.
 */
export function legacyAttribute(name: string, value: string): string | null {
  switch (name) {
    case 'style': {
      const style = filterLegacyStyle(value);
      return style === '' ? null : style;
    }
    case 'class': {
      const classes = filterLegacyClasses(value);
      return classes === '' ? null : classes;
    }
    // Art keeps its glyphs from screen readers, which read its sr-only text instead.
    case 'aria-hidden':
      return value === 'true' ? value : null;
    default:
      return DATA_ATTRIBUTES.has(name) && DATA_VALUE.test(value) ? value : null;
  }
}
