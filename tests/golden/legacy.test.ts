// Golden snapshots of the legacy terminal, recorded before the overhaul changes any behaviour.
// They document what processCommand returns today, bugs included, so every port can be
// compared against them. Read README.md in this folder before updating any of them.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPHONE_INSTAGRAM, MAC_CHROME, installDevice, type DeviceProfile } from '../support/devices';
import { createNetworkMock, type NetworkMock } from '../support/net';
import {
  formatHtmlTranscript,
  formatTextTranscript,
  normaliseSvelteMarkup,
  parseHtmlTranscript,
  type Step,
} from './format';

const ORIGIN = 'https://www.vesen.app/';
const FROZEN_NOW = new Date('2026-10-06T09:00:00+11:00');
// Pinned so a version bump does not rewrite the banner and fastfetch goldens.
const APP_VERSION = '0.0.0-golden';

interface Viewport {
  width: number;
  height: number;
}

/**
 * The plan's 40, 80 and 120 columns. The legacy code turns width into columns as
 * floor((innerWidth - 40) / 8), so these are exactly 360, 680 and 1000 px: a small phone, a
 * large phone or small tablet (the legacy code treats up to 768 px as mobile), and a desktop.
 */
const VIEWPORTS: readonly Viewport[] = [
  { width: 360, height: 780 },
  { width: 680, height: 1000 },
  { width: 1000, height: 800 },
];

interface GoldenCase {
  /** Folder under __snapshots__/legacy. */
  slug: string;
  /** Lines typed at the prompt in order, from a fresh page load. Every output is recorded. */
  lines: string[];
  /** The output depends on window.innerWidth, so each viewport gets its own golden. */
  responsive?: boolean;
  device?: DeviceProfile;
}

const CASES: GoldenCase[] = [
  { slug: 'banner', lines: ['banner'] },
  { slug: 'help', lines: ['help'], responsive: true },
  { slug: 'ls', lines: ['ls'], responsive: true },
  { slug: 'ls-a', lines: ['ls -a'], responsive: true },
  { slug: 'ls-root', lines: ['ls /'], responsive: true },
  { slug: 'ls-home', lines: ['ls /home'], responsive: true },
  { slug: 'cat-readme', lines: ['cat README.md'] },
  { slug: 'cat-history', lines: ['cat history.txt'] },
  { slug: 'cat-linux', lines: ['cat documents/linux.txt'] },
  { slug: 'theme-ls', lines: ['theme ls'] },
  { slug: 'cathode-ls', lines: ['cathode ls'] },
  {
    slug: 'history',
    // The long echo is wider than a phone's 40 columns, so history wraps it there.
    lines: ['pwd', 'cd documents', 'echo the quick brown fox jumps over the lazy dog, twice over', 'cd ..', 'history'],
    responsive: true,
  },
  { slug: 'echo-hello', lines: ['echo hello'] },
  { slug: 'echo-quoted', lines: ['echo "a" "b"'] },
  { slug: 'pwd', lines: ['pwd'] },
  { slug: 'cd-etc-pwd', lines: ['cd /etc', 'pwd'] },
  { slug: 'rm-rf', lines: ['rm -rf x'] },
  { slug: 'mkdir-p', lines: ['mkdir -p a/b'] },
  { slug: 'touch-two', lines: ['touch a b'] },
  { slug: 'qr', lines: ['qr https://www.vesen.app'] },
  { slug: 'unknown-command', lines: ['lss'] },
  { slug: 'weather-oslo', lines: ['weather Oslo'], responsive: true },
  { slug: 'stock-aapl', lines: ['stock AAPL'], responsive: true },
  { slug: 'curl-httpbin', lines: ['curl https://httpbin.org/get'], responsive: true },
  { slug: 'fastfetch-mac-chrome', lines: ['fastfetch'], responsive: true },
  { slug: 'fastfetch-iphone-instagram', lines: ['fastfetch'], responsive: true, device: IPHONE_INSTAGRAM },
];

interface HappyDOMApi {
  setURL(url: string): void;
  setViewport(viewport: Viewport): void;
}
const happyDOM = (globalThis as unknown as { happyDOM: HappyDOMApi }).happyDOM;

let bells = 0;

/** Just enough Web Audio for playBeep; each oscillator is one ring of the bell. */
class CountingAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};

  resume() {
    return Promise.resolve();
  }

  createOscillator() {
    bells += 1;
    return {
      type: 'sine',
      frequency: { setValueAtTime: () => {} },
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      onended: null,
    };
  }

  createGain() {
    const ramp = () => {};
    return {
      gain: { setValueAtTime: ramp, linearRampToValueAtTime: ramp, exponentialRampToValueAtTime: ramp },
      connect: () => {},
      disconnect: () => {},
    };
  }
}

let network: NetworkMock;
let removeDevice: (() => void) | undefined;

function useDevice(device: DeviceProfile) {
  removeDevice = installDevice(device);
}

interface LegacyTerminal {
  /** Runs a line the way Input.svelte does, including its bookkeeping in the history stores. */
  type(line: string): Promise<Step>;
  /** Mounts History.svelte over everything typed so far and returns one line per entry. */
  renderHistory(): Promise<string>;
}

/** A fresh page load at `viewport`: empty storage and new instances of every legacy module. */
async function boot(viewport: Viewport): Promise<LegacyTerminal> {
  happyDOM.setViewport(viewport);
  expect(window.innerWidth).toBe(viewport.width);
  localStorage.clear();
  vi.resetModules();

  const { processCommand } = await import('../../src/utils/commands');
  const { history, commandHistory } = await import('../../src/stores/history');

  return {
    async type(line) {
      const [name = '', ...args] = line.split(' ');
      // Input.svelte runs every line as a job with its own abort signal.
      const ringsBefore = bells;
      const html = await processCommand(line, new AbortController().signal);

      // Mirrors Input.svelte's Enter handler: reset stays out of the arrow-key history, and
      // clear and reset stay off the screen unless they were asked for help.
      if (name !== 'reset') commandHistory.update((lines) => [...lines, line]);
      const wantsHelp = args.includes('--help') || args.includes('-h');
      if (!((name === 'clear' || name === 'reset') && !wantsHelp)) {
        history.update((entries) => [...entries, { command: line, outputs: [html] }]);
      }
      return { line, html, bells: bells - ringsBefore };
    },

    async renderHistory() {
      // Imported after the reset so the component shares this boot's stores.
      const { mount, unmount, flushSync } = await import('svelte');
      const { default: History } = await import('../../src/components/History.svelte');
      const target = document.createElement('div');
      document.body.append(target);
      const component = mount(History, { target });
      flushSync();
      const entries = Array.from(target.children, (entry) => normaliseSvelteMarkup(entry.outerHTML));
      unmount(component);
      target.remove();
      return `${entries.join('\n')}\n`;
    },
  };
}

async function record(lines: readonly string[], viewport: Viewport): Promise<Step[]> {
  const terminal = await boot(viewport);
  const steps: Step[] = [];
  for (const line of lines) steps.push(await terminal.type(line));
  expect(network.unmocked, 'requests with no recorded fixture').toEqual([]);
  return steps;
}

async function expectGolden(slug: string, variant: string, steps: Step[]) {
  const html = formatHtmlTranscript(steps);
  // The format must round-trip, or tests comparing against these files would misread them.
  expect(parseHtmlTranscript(html)).toEqual(steps.map(({ line, html: output }) => ({ line, html: output })));
  await expect(html).toMatchFileSnapshot(`./__snapshots__/legacy/${slug}/${variant}.html`);
  await expect(formatTextTranscript(steps)).toMatchFileSnapshot(`./__snapshots__/legacy/${slug}/${variant}.txt`);
}

beforeAll(() => {
  happyDOM.setURL(ORIGIN);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  // stock prints volume.toLocaleString(); pin the default locale so the host's does not leak in.
  const toLocaleString = Number.prototype.toLocaleString;
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocaleString.call(this, locales ?? 'en-US', options);
  });

  network = createNetworkMock(ORIGIN);
  vi.stubGlobal('fetch', network.fetch);
  vi.stubGlobal('AudioContext', CountingAudioContext);
  vi.stubGlobal('__APP_VERSION__', APP_VERSION);
  bells = 0;
});

afterEach(() => {
  removeDevice?.();
  removeDevice = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('legacy command output', () => {
  for (const { slug, lines, responsive, device = MAC_CHROME } of CASES) {
    if (responsive) {
      it.each(VIEWPORTS)(`${slug} at $width px`, async (viewport) => {
        useDevice(device);
        await expectGolden(slug, String(viewport.width), await record(lines, viewport));
      });
    } else {
      it(`${slug} (the same at every width)`, async () => {
        useDevice(device);
        const transcripts: Step[][] = [];
        for (const viewport of VIEWPORTS) transcripts.push(await record(lines, viewport));
        const [phone, laptop, desktop] = transcripts;
        expect(phone).toEqual(desktop);
        expect(laptop).toEqual(desktop);
        await expectGolden(slug, 'all', desktop ?? []);
      });
    }
  }
});

describe('legacy History rendering', () => {
  it.each(VIEWPORTS)('the boot banner, ls, cd documents and pwd at $width px', async (viewport) => {
    useDevice(MAC_CHROME);
    const terminal = await boot(viewport);
    for (const line of ['ls', 'cd documents', 'pwd']) await terminal.type(line);
    const markup = await terminal.renderHistory();
    expect(network.unmocked).toEqual([]);
    await expect(markup).toMatchFileSnapshot(`./__snapshots__/legacy/rendered-session/${viewport.width}.html`);
  });
});
