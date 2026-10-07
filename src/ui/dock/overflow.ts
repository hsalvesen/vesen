// Says when a sideways-scrolling row has more beyond an edge (use:overflowEdges): the classes
// more-left and more-right, which the row's stylesheet fades that edge with. Checked when the
// row scrolls, and when it or anything in it changes size.
import type { ActionReturn } from 'svelte/action';

/** Within this many pixels of an edge counts as at it. */
const SLACK_PX = 1;

export function overflowEdges(node: HTMLElement): ActionReturn {
  const check = (): void => {
    const left = node.scrollLeft > SLACK_PX;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - SLACK_PX;
    node.classList.toggle('more-left', left);
    node.classList.toggle('more-right', right);
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
  const watch = (): void => {
    if (observer === null) return;
    observer.disconnect();
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
  };
  // Keys come and go (the symbols page): watch the new ones.
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
    watch();
    check();
  });
  watch();
  mutations?.observe(node, { childList: true });
  node.addEventListener('scroll', check, { passive: true });
  check();
  return {
    destroy() {
      observer?.disconnect();
      mutations?.disconnect();
      node.removeEventListener('scroll', check);
    },
  };
}
