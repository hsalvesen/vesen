// Checks the Firebase Hosting config and the two standalone pages it serves next to the app:
// public/404.html and the device probe at public/probe/index.html.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}
interface FirebaseConfig {
  hosting: { public: string; headers?: HeaderRule[]; rewrites?: unknown[] };
}

const hosting = (JSON.parse(read('firebase.json')) as FirebaseConfig).hosting;

/** The value a rule with exactly this source sets for a header, if any. */
function header(source: string, key: string): string | undefined {
  const rule = hosting.headers?.find((r) => r.source === source);
  return rule?.headers.find((h) => h.key === key)?.value;
}

/** Splits a CSP into directive name -> source list. */
function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

/** The CSP hash of each inline script, computed over its text as the HTML parser sees it. */
function inlineScriptHashes(html: string): string[] {
  const normalised = html.replace(/\r\n?/g, '\n');
  return [...normalised.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => `'sha256-${createHash('sha256').update(match[1] ?? '', 'utf8').digest('base64')}'`,
  );
}

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

const publicHtml = walk('public').filter((path) => path.endsWith('.html'));
const csp = parseCsp(header('**', 'Content-Security-Policy') ?? '');

describe('firebase.json', () => {
  it('serves dist with no catch-all rewrite, so missing files get the 404 page', () => {
    expect(hosting.public).toBe('dist');
    expect(hosting.rewrites ?? []).toEqual([]);
  });

  it('sends the security headers on every path', () => {
    expect(header('**', 'Permissions-Policy')).toBe(
      'geolocation=(self), screen-wake-lock=(self), clipboard-write=(self), camera=(), microphone=(), payment=(), usb=()',
    );
    expect(header('**', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('**', 'X-Content-Type-Options')).toBe('nosniff');
  });

  // Enforced from the first deploy: a Report-Only policy with no reporting endpoint collects
  // nothing, and e2e/hosting.spec.ts runs the app, the probe and the 404 page under it.
  it('enforces the content security policy', () => {
    expect(header('**', 'Content-Security-Policy-Report-Only')).toBeUndefined();
    expect(Object.fromEntries([...csp].filter(([name]) => name !== 'script-src'))).toEqual({
      'default-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'", 'https:'],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
    });
  });

  it('allows scripts from the origin and the static pages’ inline scripts, nothing else', () => {
    const expected = ["'self'", ...publicHtml.flatMap((path) => inlineScriptHashes(read(path)))];
    // An edited inline script needs its new hash here; this prints it.
    expect(csp.get('script-src')?.slice().sort()).toEqual(expected.sort());
  });

  it('revalidates the pages and caches hashed assets for a year', () => {
    for (const source of ['/', '/index.html', '/probe/', '/probe/index.html']) {
      expect(header(source, 'Cache-Control'), source).toBe('no-cache');
    }
    expect(header('/assets/**', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(header('/icons/**', 'Cache-Control')).toBe('public, max-age=86400');
    expect(header('/fonts/**', 'Cache-Control')).toMatch(/^public, max-age=\d+$/);
  });

  // Neither has a hash in its name, and a stale boot script would paint retired theme colours.
  it('revalidates the boot script and the manifest', () => {
    for (const source of ['/boot.js', '/manifest.webmanifest']) {
      expect(header(source, 'Cache-Control'), source).toBe('no-cache');
    }
  });
});

describe('standalone pages', () => {
  it.each(['public/404.html', 'public/probe/index.html'])('%s makes no requests to other origins', (path) => {
    const html = read(path);
    // No absolute http(s) URL in an attribute, a string or a CSS url().
    expect(html).not.toMatch(/["'(=]\s*https?:\/\//);
    expect(html).not.toMatch(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)=["']\/\//);
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });

  it('the 404 page names the missing path and links home', () => {
    const html = read('public/404.html');
    expect(html).toContain('vesen: <span data-path>this path</span>: No such file or directory');
    expect(html).toContain('<a href="/">');
  });

  describe('the path the 404 page shows', () => {
    /** Runs the page's inline script for `href` and returns what each [data-path] span says. */
    function shownPath(href: string): string[] {
      const script = /<script>([\s\S]*?)<\/script>/.exec(read('public/404.html'))?.[1] ?? '';
      const spans = [{ textContent: '' }, { textContent: '' }];
      // The browser hands the page its pathname percent-encoded, as WHATWG URL does here.
      runInNewContext(script, { location: { pathname: new URL(href).pathname }, document: { querySelectorAll: () => spans } });
      return spans.map((span) => span.textContent);
    }

    it('is the path as typed for an ordinary missing file', () => {
      expect(shownPath('https://www.vesen.app/robots.txt')).toEqual(['/robots.txt', '/robots.txt']);
    });

    it('stays encoded, so a crafted link cannot spell out a sentence', () => {
      const [shown] = shownPath('https://www.vesen.app/Your Instagram login expired - verify at instagram-help.example');
      expect(shown).not.toContain(' ');
      expect(shown?.startsWith('/Your%20Instagram%20login')).toBe(true);
    });

    it('keeps bidi and control characters encoded', () => {
      const [shown] = shownPath('https://www.vesen.app/%E2%80%AEtxt.exe%00');
      expect(shown).toBe('/%E2%80%AEtxt.exe%00');
      expect(shown).not.toMatch(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/);
    });

    it('is cut to 60 characters', () => {
      const [shown] = shownPath(`https://www.vesen.app/${'a'.repeat(500)}`);
      expect(shown).toHaveLength(60);
      expect(shown?.endsWith('…')).toBe(true);
    });
  });

  it('the probe stays under 20 kB', () => {
    expect(Buffer.byteLength(read('public/probe/index.html'))).toBeLessThan(20_000);
  });

  it('the app never links to the probe', () => {
    const shipped = [
      'index.html',
      ...walk('src').filter((path) => !/\.test\.[jt]s$/.test(path)),
      ...walk('public').filter((path) => /\.(md|txt)$/.test(path)),
    ];
    for (const path of shipped) expect(read(path), path).not.toMatch(/\/probe\b/);
  });
});
