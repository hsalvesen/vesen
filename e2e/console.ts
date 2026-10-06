// Console messages that browsers print for valid markup they choose not to support.
// They are not errors in vesen and must not fail the "no console errors" checks.
const BENIGN = [
  // WebKit (including iOS Safari) ignores the Chromium-only viewport key, as intended.
  /^Viewport argument key "interactive-widget" not recognized and ignored\.?$/,
];

export function isBenignConsoleMessage(text: string): boolean {
  return BENIGN.some((pattern) => pattern.test(text.trim()));
}
