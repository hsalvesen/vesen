// Copying text (docs/plan/designs/phone-and-instagram.md, "G. Links, email and in-app fallbacks"):
// the Clipboard API first, then a hidden textarea and execCommand('copy') for browsers and
// WebViews without it, then false, after which the card selects the text and says to press and
// hold. Call copy() inside the tap: both ways need the user's gesture.

import type { Clipboard } from './types';

export interface ClipboardHost {
  readonly navigator?: { readonly clipboard?: { writeText?(text: string): Promise<void> } };
  readonly document?: Document;
}

/** The old way: a textarea selected off-screen and the copy command. False when it fails. */
export function copyWithCommand(doc: Document | undefined, text: string): boolean {
  if (doc === undefined || doc.body === null || typeof doc.execCommand !== 'function') return false;
  const area = doc.createElement('textarea');
  area.value = text;
  // Read-only, so no keyboard opens; 16px, so iOS does not zoom while it is focused.
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;';
  const active = doc.activeElement;
  doc.body.append(area);
  let copied = false;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    area.remove();
    // Focus goes back where it was, so the prompt keeps the keyboard.
    if (active !== null && active !== doc.body) (active as HTMLElement).focus?.({ preventScroll: true });
  }
  return copied;
}

export function createClipboard(host: ClipboardHost): Clipboard {
  return {
    async copy(text) {
      const api = host.navigator?.clipboard;
      if (typeof api?.writeText === 'function') {
        try {
          await api.writeText(text);
          return true;
        } catch {
          // Denied, or not inside a gesture any more: try the old way.
        }
      }
      return copyWithCommand(host.document, text);
    },
  };
}
