// The QR card (docs/plan/06-qr.md, "What visitors get"): the code in the theme's QR roles inside
// a 4-module quiet zone, exactly what was encoded as text, the meta line and hint, and trusted
// action buttons that differ by device; save is hidden inside in-app browsers.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toText } from '../../lib/qr';
import { cathode, DEFAULT_CATHODE_MODE } from '../../stores/cathode';
import { qrView } from '../../testing/qr-view';
import QrCard from './QrCard.svelte';

const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0';

/** Stubs of the navigator fields the card reads, removed after each test. */
const stubbed: string[] = [];

function stubNavigator(field: string, value: unknown): void {
  Object.defineProperty(navigator, field, { configurable: true, value });
  stubbed.push(field);
}

/** The device the card is drawn on: touch or not, its user agent, and the clipboard's answer. */
function device(o: { touch?: boolean; userAgent?: string; copies?: boolean; share?: boolean } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: o.touch === true && query === '(pointer: coarse)', media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
  stubNavigator('userAgent', o.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0');
  const writeText = vi.fn(async () => {
    if (o.copies === false) throw new Error('denied');
  });
  stubNavigator('clipboard', { writeText });
  if (o.share === true) {
    stubNavigator('share', vi.fn());
    stubNavigator('canShare', () => true);
  }
  return { writeText };
}

afterEach(() => {
  cathode.set(DEFAULT_CATHODE_MODE);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const field of stubbed.splice(0)) delete (navigator as unknown as Record<string, unknown>)[field];
});

function show(words: string[], on: Parameters<typeof device>[0] = {}) {
  const stubs = device(on);
  const view = qrView(...words);
  const result = render(QrCard, { props: { view, alt: `QR code for ${view.payload}` } });
  return { ...result, view, ...stubs };
}

const buttonNames = () => screen.getAllByRole('button').map((button) => button.textContent?.trim() || button.getAttribute('aria-label'));

describe('QrCard', () => {
  it("draws the code as one path in the theme's QR ink on its QR paper, inside a 4-module quiet zone", () => {
    const { container, view } = show(['vesen.app']);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${view.size + 8} ${view.size + 8}`);
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('rect')?.getAttribute('style')).toBe('fill: var(--role-qr-paper, #fff)');
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute('style')).toBe('stroke: var(--role-qr-ink, #000)');
    // The finder pattern's top row: seven dark modules, four in from each edge.
    expect(paths[0]!.getAttribute('d')?.startsWith('M4 4.5h7')).toBe(true);
    // Nothing measured yet: 8 pixels a module on a desktop.
    const figure = container.querySelector<HTMLElement>('[data-qr-figure]')!;
    expect(figure.style.width).toBe(`${8 * (view.size + 8)}px`);
    expect(figure.style.height).toBe(`${8 * (view.size + 8)}px`);
    expect(figure.getAttribute('aria-label')).toBe('QR code for https://vesen.app. Show full screen');
  });

  it('shows exactly what was encoded as text, the meta line, and what scanning does', () => {
    const { container, view } = show(['<u>x</u>']);
    expect(container.querySelector('u')).toBeNull();
    expect(container.querySelector('.qr-payload')?.textContent).toBe('<u>x</u>');
    expect(container.querySelector('.qr-meta')?.textContent).toBe(`v1 · 21×21 · EC ${view.ecc} · 8/${view.capacity} B · mask ${view.mask}`);
    expect(screen.getByText('Scan with your phone camera to read the text')).toBeInTheDocument();
  });

  it('notes https:// on the head line, and that the level was raised', () => {
    const { container } = show(['vesen.app']);
    expect(container.querySelector('.qr-head')?.textContent).toBe('qr https://vesen.app · added https:// · --text encodes exactly what you typed');
    expect(container.querySelector('.qr-meta')?.getAttribute('title')).toBe('Error correction raised from M to Q for free; -e M keeps M.');
    expect(screen.getByText('Scan with your phone camera to open the link')).toBeInTheDocument();
  });

  it('shows tips under the meta line', () => {
    show(['has@salvesen.app']);
    expect(screen.getByText('tip: use qr mailto:has@salvesen.app for a tap-to-email code')).toBeInTheDocument();
  });

  it('offers full screen, save png, save svg and copy on a desktop', () => {
    show(['vesen.app']);
    expect(buttonNames()).toEqual(['QR code for https://vesen.app. Show full screen', 'full screen', 'save png', 'save svg', 'copy']);
    expect(screen.getByRole('group', { name: 'QR code actions' })).toBeInTheDocument();
  });

  it('offers full screen and copy on a phone, and says to tap', () => {
    show(['vesen.app'], { touch: true });
    expect(buttonNames()).toEqual(['QR code for https://vesen.app. Show full screen', 'full screen', 'copy']);
    expect(screen.getByText('Tap the code for full screen, then let a friend scan it')).toBeInTheDocument();
  });

  it('offers share on a phone where files can be shared', () => {
    show(['vesen.app'], { touch: true, share: true });
    expect(buttonNames()).toEqual(['QR code for https://vesen.app. Show full screen', 'full screen', 'share', 'copy']);
  });

  it('hides save inside an in-app browser', () => {
    show(['vesen.app'], { userAgent: INSTAGRAM_UA });
    expect(buttonNames()).toEqual(['QR code for https://vesen.app. Show full screen', 'full screen', 'copy']);
  });

  it('never takes focus from the prompt when a button is pressed', async () => {
    show(['vesen.app']);
    for (const button of screen.getAllByRole('button')) expect(await fireEvent.mouseDown(button)).toBe(false);
  });

  it("copies through the page's clipboard, and says so politely for four seconds", async () => {
    vi.useFakeTimers();
    const { writeText } = show(['vesen.app']);
    await fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith('https://vesen.app');
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Copied.');
    await vi.advanceTimersByTimeAsync(4000);
    expect(status.textContent).toBe('');
  });

  it('shows the payload selected when copying fails', async () => {
    show(['hello world'], { copies: false });
    await fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await tick();
    await tick();
    expect(screen.getByRole('status').textContent).toBe("Couldn't copy here. Press and hold the text to copy it.");
    expect(document.querySelector('.qr-fallback')?.textContent).toBe('hello world');
    expect(window.getSelection()?.toString()).toBe('hello world');
  });

  it('opens Present mode on a tap of the code, and gives focus back when it closes', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    show(['vesen.app']);
    await fireEvent.click(screen.getByRole('button', { name: 'QR code for https://vesen.app. Show full screen' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('img')?.getAttribute('src')?.startsWith('data:image/png;base64,')).toBe(true);
    // The rest of the page sleeps meanwhile.
    expect(Array.from(document.body.children).filter((child) => !child.hasAttribute('data-qr-present-host')).every((child) => child.hasAttribute('inert'))).toBe(true);
    await fireEvent.keyDown(window, { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(Array.from(document.body.children).some((child) => child.hasAttribute('inert'))).toBe(false);
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('draws text art with -t utf8: light on an ink field, hidden from screen readers', () => {
    const { container, view } = show(['-t', 'utf8', 'hello']);
    const art = container.querySelector<HTMLElement>('[data-qr-text]')!;
    expect(art.textContent).toBe(toText(view, { style: 'utf8', margin: 2 }).join('\n'));
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.sr-only')?.textContent).toBe('QR code for hello');
  });

  it('suggests full screen in vintage mode, whose filter keeps the code under the glass', async () => {
    show(['vesen.app']);
    cathode.set('vintage');
    await tick();
    expect(screen.getByText('Scan with your phone camera to open the link, or click it for a clean full-screen view')).toBeInTheDocument();
  });

  it('draws nothing for a malformed view', () => {
    device();
    const { container } = render(QrCard, { props: { view: { payload: 'x' }, alt: 'x' } });
    expect(container.querySelector('[data-qr-card]')).toBeNull();
  });
});
