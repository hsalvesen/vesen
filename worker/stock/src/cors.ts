// Which browser origins the Worker answers. An origin check is not authentication (curl can send
// any Origin), but it keeps other sites from building on vesen's quota. Requests with no Origin,
// such as curl or the canary, are served under a tighter rate limit.

export type OriginVerdict = 'allowed' | 'anonymous' | 'denied';

export interface OriginPolicy {
  classify(origin: string | null): OriginVerdict;
}

/**
 * Turns one ALLOWED_ORIGINS entry into an anchored pattern. A `*` in the host matches one or more
 * DNS-label characters (`https://vesenterminal--*.web.app`); a trailing `:*` matches any port or
 * none (`http://localhost:*`). Everything else must match exactly.
 */
export function originPattern(entry: string): RegExp {
  const escape = (text: string): string => text.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
  const portWildcard = entry.endsWith(':*');
  const body = portWildcard ? entry.slice(0, -2) : entry;
  const host = body.split('*').map(escape).join('[a-z0-9-]+');
  return new RegExp(`^${host}${portWildcard ? '(?::\\d{1,5})?' : ''}$`);
}

/** Builds the policy from a comma-separated list of exact origins and `*` patterns. */
export function originPolicy(list: string): OriginPolicy {
  const entries = list
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/\/+$/, ''))
    .filter((entry) => entry !== '');
  const exact = new Set(entries.filter((entry) => !entry.includes('*')));
  const patterns = entries.filter((entry) => entry.includes('*')).map(originPattern);

  return {
    classify(origin) {
      if (origin === null) return 'anonymous';
      const candidate = origin.toLowerCase();
      if (exact.has(candidate) || patterns.some((pattern) => pattern.test(candidate))) return 'allowed';
      return 'denied';
    },
  };
}

export const EXPOSED_HEADERS = 'Retry-After, X-Vesen-Cache, X-Vesen-Source';

/**
 * CORS headers for a response. An allowed origin is echoed. A denied one is echoed too, but only
 * on its 403, so a copy of vesen on another domain can read why and say so.
 */
export function corsHeaders(origin: string | null, verdict: OriginVerdict): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Expose-Headers': EXPOSED_HEADERS,
  };
  if (origin !== null && verdict !== 'anonymous' && /^https?:\/\/[^\s,]+$/.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}
