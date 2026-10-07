// The link card (designs/phone-and-instagram.md, "G"): a real anchor that opens in a new tab in a
// browser and in the same view in an in-app one, Copy with '✓ Copied' for two seconds, and on a
// failed copy the text selected and 'Press and hold to copy'.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { out, type CardBlock } from '../../output/model';
import { LINK_POLICY_KEY, type LinkPolicy } from '../links';
import LinkCard from './LinkCard.svelte';

afterEach(() => vi.useRealTimers());

function policy(extra: Partial<LinkPolicy> = {}): LinkPolicy {
  return {
    target: '_blank',
    inApp: null,
    touch: true,
    copy: vi.fn(async () => true),
    escapeHref: () => null,
    openExternal: vi.fn(),
    ...extra,
  };
}

function show(card: CardBlock, links: LinkPolicy) {
  return render(LinkCard, { props: { card }, context: new Map([[LINK_POLICY_KEY, links]]) });
}

const linkedin = out.card({ title: 'LinkedIn', href: 'https://www.linkedin.com/in/harrysalvesen/' });
const email = out.card({
  title: 'Email',
  href: 'mailto:has@salvesen.app?subject=Hi',
  label: 'has@salvesen.app',
  copy: 'has@salvesen.app',
  copyLabel: '⧉ Copy address',
  openLabel: '✉ Open mail app',
  escape: { url: 'https://www.vesen.app/', hint: "If the mail app doesn't open, copy the address, or open vesen.app in the browser:" },
});

describe('LinkCard', () => {
  it('is a titled group with the link as a real anchor', () => {
    show(linkedin, policy());
    expect(screen.getByRole('group', { name: 'LinkedIn' })).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://www.linkedin.com/in/harrysalvesen/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('↗ linkedin.com/in/harrysalvesen');
  });

  it('opens in the same view inside an in-app browser, so Back returns', () => {
    show(linkedin, policy({ target: '_self', inApp: { label: 'Instagram', browser: 'Safari', menuHint: '••• → Open in browser' } }));
    expect(screen.getByRole('link').getAttribute('target')).toBe('_self');
  });

  it("says '✓ Copied' for two seconds, politely", async () => {
    vi.useFakeTimers();
    const links = policy();
    show(linkedin, links);
    const button = screen.getByRole('button', { name: '⧉ Copy' });
    await fireEvent.click(button);
    await tick();
    expect(links.copy).toHaveBeenCalledWith('https://www.linkedin.com/in/harrysalvesen/');
    expect(button.textContent?.trim()).toBe('✓ Copied');
    expect(screen.getByRole('status').textContent).toBe('Copied');
    vi.advanceTimersByTime(2000);
    await tick();
    expect(button.textContent?.trim()).toBe('⧉ Copy');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it("selects the text and says 'Press and hold to copy' when copying fails", async () => {
    show(email, policy({ copy: async () => false }));
    await fireEvent.click(screen.getByRole('button', { name: '⧉ Copy address' }));
    await tick();
    await tick();
    expect(screen.getByText('has@salvesen.app', { selector: '.card-copy-text' })).toBeInTheDocument();
    expect(document.getSelection()?.toString()).toBe('has@salvesen.app');
    expect(screen.getByText(/Press and hold to copy/, { selector: '.muted' })).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('Could not copy. Press and hold to copy.');
  });

  it('gives mail an Open mail app anchor and Copy address, and opens nothing by itself', () => {
    show(email, policy());
    const open = screen.getByRole('link', { name: '✉ Open mail app' });
    expect(open.getAttribute('href')).toBe('mailto:has@salvesen.app?subject=Hi');
    expect(open.hasAttribute('target')).toBe(false);
    expect(screen.getByText('has@salvesen.app')).toBeInTheDocument();
    // Not in an in-app browser: no way out to offer.
    expect(screen.queryByText(/Open in browser/)).toBeNull();
  });

  it('offers the real browser inside an in-app one, only beside the manual instruction, and only on a tap', async () => {
    const links = policy({
      target: '_self',
      inApp: { label: 'Instagram', browser: 'Safari', menuHint: '••• → Open in browser' },
      escapeHref: (url) => `instagram://extbrowser/?url=${encodeURIComponent(url)}`,
    });
    show(email, links);
    expect(screen.getByText(/mail app doesn't open/)).toBeInTheDocument();
    expect(screen.getByText('••• → Open in browser')).toBeInTheDocument();
    expect(links.openExternal).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Open in Safari ↗' }));
    expect(links.openExternal).toHaveBeenCalledWith('https://www.vesen.app/');
  });

  it('keeps the instruction where there is no escape, as in Facebook on iOS', () => {
    show(email, policy({ inApp: { label: 'Facebook', browser: 'Safari', menuHint: '••• → Open in browser' } }));
    expect(screen.getByText('••• → Open in browser')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open in Safari/ })).toBeNull();
  });
});
