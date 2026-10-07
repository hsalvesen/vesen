// The width the QR card and Present mode fit themselves to: read when the node is drawn, and
// again a frame after the window changes size (a rotation, a resized window, the text size that
// follows the width). Not a ResizeObserver: the card resizing itself under one makes WebKit
// report a "ResizeObserver loop" error, and the terminal's width only changes with the window's.

import type { ActionReturn } from 'svelte/action';

/** Calls `report` with the node's content width now, and a frame after each resize of the window. */
export function measureWidth(node: HTMLElement, report: (width: number) => void): ActionReturn<(width: number) => void> {
  let callback = report;
  let frame = 0;
  const win = node.ownerDocument.defaultView;
  const read = (): void => {
    frame = 0;
    callback(node.clientWidth);
  };
  const onResize = (): void => {
    if (frame === 0 && win !== null) frame = win.requestAnimationFrame(read);
  };
  read();
  win?.addEventListener('resize', onResize);
  return {
    update(next) {
      callback = next;
    },
    destroy() {
      win?.removeEventListener('resize', onResize);
      if (frame !== 0) win?.cancelAnimationFrame(frame);
    },
  };
}
