// The legacyHtml block's action: the shim and its allowlist load in their own chunk with the
// first such block, and draw the latest HTML, never into an element that has gone.
import { describe, expect, it } from 'vitest';
import { legacyBlock, loadLegacyShim } from './legacy-block';

/** The action on a new element, with what it returns. */
function mount(html: string) {
  const node = document.createElement('div');
  const handle = legacyBlock(node, html);
  if (!handle) throw new Error('legacyBlock must return update and destroy');
  return { node, handle };
}

describe('legacyBlock', () => {
  it('loads the shim once and draws the sanitised HTML when it arrives', async () => {
    expect(loadLegacyShim()).toBe(loadLegacyShim());
    const { node } = mount('<b>ok</b><img src=x onerror=window.__x=1>');
    await loadLegacyShim();
    await Promise.resolve();
    expect(node.innerHTML).toBe('<b>ok</b>');
  });

  it('draws the latest HTML after an update', async () => {
    const { node, handle } = mount('<i>first</i>');
    handle.update?.('<i>second</i>');
    await loadLegacyShim();
    await Promise.resolve();
    expect(node.innerHTML).toBe('<i>second</i>');
  });

  it('never draws into an element that has gone', async () => {
    const { node, handle } = mount('<b>late</b>');
    handle.destroy?.();
    await loadLegacyShim();
    await Promise.resolve();
    expect(node.innerHTML).toBe('');
  });
});
