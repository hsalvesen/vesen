// The legacy HTML shim: renders a legacy command's HTML string as a sanitised DOM fragment.
//
// The string is parsed by the browser's own HTML parser inside an inert document (no scripts
// run, nothing loads, no event fires), then a new tree is built in the page's document from
// the allowlist in output/legacy-policy.ts: element by element, attribute by attribute, with
// text copied as text nodes. Nothing is ever serialised and parsed again, so markup that
// changes meaning on a second parse (mutation XSS) has no second parse to exploit.
//
// Deleted with the legacyHtml block once the last legacy command is ported.

import type { Action } from 'svelte/action';
import {
  LEGACY_DROP_WITH_CONTENT,
  LEGACY_TAGS,
  legacyAttribute,
  legacyHref,
} from '../output/legacy-policy';
import { textWidth } from '../output/model';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Deeper than any legacy output; below this, what remains is kept as plain text. */
const MAX_DEPTH = 64;

let inert: Document | undefined;

/** One document with no browsing context, made once and reused for every parse. */
function inertDocument(): Document {
  inert ??= document.implementation.createHTMLDocument('');
  return inert;
}

function copyAttributes(from: Element, to: Element): void {
  for (const { name, value } of Array.from(from.attributes)) {
    if (name === 'href') {
      if (to.localName !== 'a') continue;
      const href = legacyHref(value);
      if (href === null) continue;
      to.setAttribute('href', href);
      to.setAttribute('target', '_blank');
      to.setAttribute('rel', 'noopener noreferrer');
      continue;
    }
    const kept = legacyAttribute(name, value);
    if (kept !== null) to.setAttribute(name, kept);
  }
}

function copyChildren(from: Node, into: Node, target: Document, depth: number): void {
  for (const node of Array.from(from.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      into.appendChild(target.createTextNode((node as Text).data));
      continue;
    }
    // Comments, processing instructions and CDATA are dropped.
    if (node.nodeType !== ELEMENT_NODE) continue;

    const element = node as Element;
    const name = element.localName;
    if (element.namespaceURI !== HTML_NAMESPACE || LEGACY_DROP_WITH_CONTENT.has(name)) continue;
    if (depth >= MAX_DEPTH) {
      into.appendChild(target.createTextNode(element.textContent ?? ''));
      continue;
    }
    if (!LEGACY_TAGS.has(name)) {
      copyChildren(element, into, target, depth + 1);
      continue;
    }
    const copy = target.createElement(name);
    copyAttributes(element, copy);
    copyChildren(element, copy, target, depth + 1);
    into.appendChild(copy);
  }
}

/**
 * Parses legacy command HTML and returns a fragment of `target` that holds only allowlisted
 * elements, attributes, classes and styles, and every piece of text.
 */
export function sanitizeLegacyHtml(html: string, target: Document = document): DocumentFragment {
  // A template's content is parsed the way Svelte parsed legacy output, in a fragment context,
  // so leading whitespace and stray end tags behave exactly as they did before.
  const template = inertDocument().createElement('template');
  template.innerHTML = html;
  const fragment = target.createDocumentFragment();
  copyChildren(template.content, fragment, target, 0);
  return fragment;
}

/**
 * Gives each `.art-fit` element its widest row as `--art-cols`, which the stylesheet divides the
 * width by to shrink the art until it fits. Counted here from the text, so the policy never has to
 * let a custom property through from command output.
 */
export function sizeFittedArt(root: ParentNode): void {
  for (const art of Array.from(root.querySelectorAll<HTMLElement>('.art-fit'))) {
    const rows = (art.textContent ?? '').split('\n');
    const widest = rows.reduce((max, row) => Math.max(max, textWidth(row)), 1);
    art.style.setProperty('--art-cols', String(widest));
  }
}

/** `use:legacyHtml={html}`: replaces the element's children with the sanitised fragment. */
export const legacyHtml: Action<HTMLElement, string> = (node, html) => {
  const render = (value: string): void => {
    const fragment = sanitizeLegacyHtml(value, node.ownerDocument);
    sizeFittedArt(fragment);
    node.replaceChildren(fragment);
  };
  render(html);
  return { update: render };
};
