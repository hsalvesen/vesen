// Draws a legacyHtml block through the legacy HTML shim (ui/legacy-html.ts) and its allowlist
// (output/legacy-policy.ts), which load in their own chunk with the first such block rather than
// with the first paint. Until the shim is here the block stays empty: the HTML string itself is
// never put on the page. Bootstrap also warms the chunk once the page is idle, so legacy output
// rarely waits for it.
//
// Deleted with the legacyHtml block once the last legacy command is ported.

import type { Action } from 'svelte/action';

type Shim = typeof import('./legacy-html');

let shim: Promise<Shim> | undefined;

/** The shim, loaded once; a failed load is tried again next time. */
export function loadLegacyShim(): Promise<Shim> {
  if (shim === undefined) {
    const loading = import('./legacy-html');
    loading.catch(() => {
      if (shim === loading) shim = undefined;
    });
    shim = loading;
  }
  return shim;
}

/** `use:legacyBlock={html}`: the sanitised fragment of `html`, once the shim has loaded. */
export const legacyBlock: Action<HTMLElement, string> = (node, html) => {
  let current = html;
  let live = true;
  const draw = (): void => {
    loadLegacyShim().then(
      ({ renderLegacyHtml }) => {
        // Drawn with the latest HTML, and never into an element that has gone.
        if (live) renderLegacyHtml(node, current);
      },
      // A chunk from an older deploy: platform/chunkReload reloads the page.
      () => {},
    );
  };
  draw();
  return {
    update(value) {
      current = value;
      draw();
    },
    destroy() {
      live = false;
    },
  };
};
