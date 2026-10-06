// Checks the Firebase Hosting config and the two standalone pages it serves next to the app:
// public/404.html and the device probe at public/probe/index.html.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const csp = parseCsp(header('**', 'Content-Security-Policy-Report-Only') ?? '');

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

  it('ships the content security policy as Report-Only', () => {
    expect(header('**', 'Content-Security-Policy')).toBeUndefined();
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
    for (const source of ['/favicons/**', '/fonts/**']) {
      expect(header(source, 'Cache-Control'), source).toMatch(/^public, max-age=\d+$/);
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
