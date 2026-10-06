/** The one origin vesen is served from; storage and the prompt depend on it. */
export const CANONICAL_ORIGIN = 'https://www.vesen.app';

/** Hostnames that serve the same build and should hand the visitor to the canonical origin. */
const ALIAS_HOSTS: ReadonlySet<string> = new Set([
  'vesen.app',
  'vesenterminal.web.app',
  'vesenterminal.firebaseapp.com',
]);

/**
 * Decides whether a page URL should move to the canonical origin.
 * Returns the URL to `location.replace()` to, keeping the path, query and hash, or null
 * to stay. Firebase preview channels (`<site>--<channel>.web.app`) always stay.
 */
export function canonicalRedirect(url: URL): string | null {
  // A fully qualified name may end in a dot ("vesen.app.").
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.includes('--') || !ALIAS_HOSTS.has(host)) return null;
  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}${url.hash}`;
}
