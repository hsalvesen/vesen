// Console messages that browsers print for valid markup they choose not to support, and the
// one request vesen makes that may fail by design.
// They are not errors in vesen and must not fail the "no console errors" checks.
const BENIGN = [
  // WebKit (including iOS Safari) ignores the Chromium-only viewport key, as intended.
  /^Viewport argument key "interactive-widget" not recognized and ignored\.?$/,
];

/**
 * Files the app asks for that need not exist: sudo's show looks for the owner's frames file
 * (src/services/frames.ts) and leaves its stage empty when there is none (as e2e/sudo.spec.ts
 * arranges), so its 404 is expected.
 */
const OPTIONAL = ['/audio/incident-report.frames'];

/** `url` is where the message came from (message.location().url), the resource for a failed load. */
export function isBenignConsoleMessage(text: string, url = ''): boolean {
  const trimmed = text.trim();
  if (BENIGN.some((pattern) => pattern.test(trimmed))) return true;
  const notFound = /^Failed to load resource: the server responded with a status of 404\b/.test(trimmed);
  return notFound && OPTIONAL.some((path) => url.includes(path) || trimmed.includes(path));
}
