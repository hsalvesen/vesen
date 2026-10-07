// Text from an upstream service, made fit to show: a quote's company name, a place from a
// geocoder or an IP lookup. One copy for every command that shows such text (02, section 9): the
// market normaliser, which the stock Worker bundles too, and weather's sources.
//
// Controls become spaces, so an escape sequence in a name can never reach the terminal as SGR
// styling or an OSC 8 link; bidirectional marks, embeddings, overrides and isolates go, so a name
// cannot reorder the text around it; runs of whitespace collapse; and the length is capped.

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/** `value` as display text, at most `max` characters; null when it is not a string or nothing is left. */
export function upstreamText(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(CONTROLS, ' ').replace(BIDI_CONTROLS, '').replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean.slice(0, max);
}
