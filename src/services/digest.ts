// Hashes through the browser's WebCrypto (services/types.ts, Digest), for sha1sum, sha256sum and
// sha512sum: commands are DOM-free and reach it as ctx.digest. WebCrypto exists only in a secure
// context (https, or localhost), so elsewhere every hash rejects and the command says why.

import type { Digest } from './types';

/** The message a command shows when the page has no WebCrypto. */
export const NO_WEBCRYPTO = 'WebCrypto is not available on this page (it needs https)';

/** The page's WebCrypto, or `subtle` instead; null stands for a page without it. */
export function createDigest(subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null): Digest {
  return {
    async hash(algorithm, data) {
      if (subtle === null) throw new Error(NO_WEBCRYPTO);
      // A copy in its own buffer, as digest() wants a plain ArrayBuffer view.
      return new Uint8Array(await subtle.digest(algorithm, data.slice()));
    },
  };
}
