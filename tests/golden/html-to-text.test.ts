// Cross-checks the DOM-free htmlToText (src/output) against the DOM-based reader the goldens
// use, on every recorded legacy output. Pipes from legacyHtml blocks therefore read exactly as
// the text goldens do.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { htmlToText } from '../../src/output/html-to-text';
import { htmlToPlainText, parseHtmlTranscript } from './format';

const LEGACY = join(dirname(fileURLToPath(import.meta.url)), '__snapshots__', 'legacy');

const steps = readdirSync(LEGACY)
  // The rendered session is the DOM of the transcript (ui/Transcript.svelte), not command output.
  .filter((name) => name !== 'rendered-session')
  .flatMap((name) =>
    readdirSync(join(LEGACY, name))
      .filter((file) => file.endsWith('.html'))
      .flatMap((file) =>
        parseHtmlTranscript(readFileSync(join(LEGACY, name, file), 'utf8')).map((step) => ({
          label: `${name}/${file}: ${step.line}`,
          html: step.html,
        })),
      ),
  );

describe('htmlToText on the legacy goldens', () => {
  it('has outputs to compare', () => {
    expect(steps.length).toBeGreaterThan(20);
  });

  it.each(steps.map((step) => [step.label, step.html] as const))('%s', (_label, html) => {
    expect(htmlToText(html)).toBe(htmlToPlainText(html));
  });
});
