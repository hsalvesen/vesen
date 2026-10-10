// The in-app link policy (docs/plan/02-architecture-and-contracts.md, section 7): what opens by
// itself, where a tapped link opens, and the escape to the real browser, by user agent.
import { describe, expect, it, vi } from 'vitest';
import { linkEnv, type LinkEnv } from '../platform/env';
import { createOpener, escapeHref, inAppInfo, planOpen, type OpenerHost } from './opener';

const UA = {
  desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 0)',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Instagram 343.0.0.38.94 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 627400398)',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  iosFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0]',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
} as const;

/** The device as each browser reports it: phones have a coarse pointer. */
const env = (ua: string, coarsePointer = !ua.includes('Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')): LinkEnv =>
  linkEnv(ua, { coarsePointer, maxTouchPoints: coarsePointer ? 5 : 0 });

const LINKEDIN = 'https://www.linkedin.com/in/harrysalvesen/';

describe('planOpen', () => {
  it.each([
    ['desktop Chrome', UA.desktopChrome, 'window', '_blank'],
    ['iOS Safari', UA.iosSafari, 'card-only', '_blank'],
    ['iOS Instagram', UA.iosInstagram, 'self', '_self'],
    ['Android Instagram', UA.androidInstagram, 'self', '_self'],
    ['Android Chrome', UA.androidChrome, 'card-only', '_blank'],
  ] as const)('%s: a web link is %s, and a tapped link opens in %s', (_name, ua, mode, target) => {
    expect(planOpen(LINKEDIN, env(ua))).toEqual({ mode, target });
  });

  it('never opens a mail app by itself, even on a desktop', () => {
    expect(planOpen('mailto:has@salvesen.app', env(UA.desktopChrome))).toEqual({ mode: 'card-only', target: '_blank' });
    expect(planOpen('mailto:has@salvesen.app', env(UA.iosInstagram)).mode).toBe('self');
  });

  it('treats a touch screen as a phone, whatever its user agent says', () => {
    expect(planOpen(LINKEDIN, env(UA.desktopChrome, true)).mode).toBe('card-only');
    // iPadOS asks for the desktop site and says it is a Mac; it has touch points.
    expect(env(UA.ipadDesktopMode, true)).toEqual({ inApp: null, os: 'ios', desktop: false });
  });
});

describe('escapeHref', () => {
  it("uses Instagram's own scheme on iOS", () => {
    expect(escapeHref('https://www.vesen.app/', env(UA.iosInstagram))).toBe('instagram://extbrowser/?url=https%3A%2F%2Fwww.vesen.app%2F');
  });

  it('asks Android for Chrome, falling back to the page', () => {
    expect(escapeHref('https://www.vesen.app/a?b=1', env(UA.androidInstagram))).toBe(
      'intent://www.vesen.app/a?b=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fwww.vesen.app%2Fa%3Fb%3D1;end',
    );
  });

  it('has none in a real browser, for Facebook on iOS, or for anything but the web', () => {
    expect(escapeHref('https://www.vesen.app/', env(UA.iosSafari))).toBeNull();
    expect(escapeHref('https://www.vesen.app/', env(UA.desktopChrome))).toBeNull();
    expect(escapeHref('https://www.vesen.app/', env(UA.iosFacebook))).toBeNull();
    expect(escapeHref('mailto:has@salvesen.app', env(UA.androidInstagram))).toBeNull();
  });

  it('names the real browser and the menu by system', () => {
    expect(inAppInfo(env(UA.iosInstagram))).toEqual({ label: 'Instagram', browser: 'Safari', menuHint: '••• → Open in browser' });
    // Android's menu is three dots one above the other, which the terminal's font lacks: named instead.
    expect(inAppInfo(env(UA.androidInstagram))).toEqual({ label: 'Instagram', browser: 'Chrome', menuHint: 'Menu → Open in browser' });
    expect(inAppInfo(env(UA.androidChrome))).toBeNull();
  });
});

describe('createOpener', () => {
  function host(result: Window | null | 'throw' = null): OpenerHost & { open: ReturnType<typeof vi.fn>; assigned: string[] } {
    const assigned: string[] = [];
    const open = vi.fn(() => {
      if (result === 'throw') throw new Error('blocked');
      return result;
    });
    return { open, assigned, location: { assign: (url: string) => void assigned.push(url) } };
  }

  it('opens in the gesture on a desktop, once, with noopener and noreferrer', () => {
    const browser = host();
    const opener = createOpener(browser, env(UA.desktopChrome));
    expect(opener.autoOpen).toBe(true);
    // noopener makes window.open return null even when the tab opened.
    expect(opener.preflight(LINKEDIN)).toBe('opened');
    expect(browser.open).toHaveBeenCalledTimes(1);
    expect(browser.open).toHaveBeenCalledWith(LINKEDIN, '_blank', 'noopener,noreferrer');
    expect(createOpener(host('throw'), env(UA.desktopChrome)).preflight(LINKEDIN)).toBe('blocked');
  });

  it('cuts a tab a browser hands back anyway loose from the page', () => {
    const tab = { opener: {} as unknown } as Window;
    expect(createOpener(host(tab), env(UA.desktopChrome)).preflight(LINKEDIN)).toBe('opened');
    expect(tab.opener).toBeNull();
  });

  it('opens nothing by itself inside Instagram, and a tapped link in the same view', () => {
    const browser = host();
    const opener = createOpener(browser, env(UA.iosInstagram));
    expect(opener.autoOpen).toBe(false);
    expect(opener.preflight(LINKEDIN)).toBe('skipped');
    expect(browser.open).not.toHaveBeenCalled();
    expect(opener.open(LINKEDIN)).toBe('opened');
    expect(browser.assigned).toEqual([LINKEDIN]);
    expect(opener.menuHint()).toBe('••• → Open in browser');
    expect(opener.inApp?.browser).toBe('Safari');
  });

  it('leaves for the real browser only through the escape, and only where there is one', () => {
    const browser = host();
    expect(createOpener(browser, env(UA.iosInstagram)).openExternal('https://www.vesen.app/')).toBe(true);
    expect(browser.assigned).toEqual(['instagram://extbrowser/?url=https%3A%2F%2Fwww.vesen.app%2F']);
    expect(createOpener(browser, env(UA.iosSafari)).openExternal('https://www.vesen.app/')).toBe(false);
  });

  it('waits for a tap on phones, then opens a new tab', () => {
    const browser = host();
    const opener = createOpener(browser, env(UA.androidChrome));
    expect(opener.preflight(LINKEDIN)).toBe('skipped');
    expect(opener.open(LINKEDIN)).toBe('opened');
    expect(browser.open).toHaveBeenCalledWith(LINKEDIN, '_blank', 'noopener,noreferrer');
  });

  it('shares through the system sheet when there is one', async () => {
    const share = vi.fn(async () => {});
    const opener = createOpener({ ...host(), navigator: { share } }, env(UA.iosSafari));
    expect(opener.canShare()).toBe(true);
    expect(await opener.share({ url: 'https://www.vesen.app/' })).toBe('shared');
    expect(await createOpener(host(), env(UA.iosSafari)).share({ url: 'https://x.example/' })).toBe('unavailable');
  });
});
