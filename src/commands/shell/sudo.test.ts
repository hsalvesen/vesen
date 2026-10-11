// sudo: the password prompt in sudo's words, masked and dropped; then the show (the Rick app with
// the dancer and the tune) on the terminal, and the sudoers line after it; the message alone in
// a pipe or where no app can show; and ^C at either stage.
import { describe, expect, it, vi } from 'vitest';
import type { Block } from '../../output/model';
import { plain } from '../../output/plain';
import type { KV } from '../../services/types';
import { createAppRunner } from '../../shell/apps';
import type { Shell } from '../../shell/index';
import type { FullscreenView } from '../../shell/types';
import { harness } from '../../testing/shell-harness';
import rm from '../files/rm';
import { RICK_CLOSED, RICK_SONG, rickFrames, type RickView } from '../lib/rick';
import sudo, { SUDO_HINT } from './sudo';

const SECRET = 'hunter2-correct-horse';

/** A terminal that shows each app and closes it at once, recording what was shown. */
function terminal(options: { touch?: boolean; fullscreen?: (view: FullscreenView, props: unknown, signal: AbortSignal) => Promise<unknown> } = {}) {
  const shown: { view: FullscreenView; props: RickView }[] = [];
  const fullscreen = vi.fn(async (view: FullscreenView, props: unknown, signal: AbortSignal): Promise<unknown> => {
    shown.push({ view, props: props as RickView });
    if (options.fullscreen) return options.fullscreen(view, props, signal);
    return RICK_CLOSED;
  });
  return { shown, fullscreen, info: { size: () => ({ cols: 80, rows: 24 }), touch: options.touch ?? false, inApp: null, fullscreen } };
}

/** Storage that keeps everything written, to look for the secret in. */
function memoryStorage(): KV<'local'> & { dump(): string } {
  const items = new Map<string, string>();
  return {
    persistent: true,
    get: (key) => items.get(key) ?? null,
    set: (key, value) => {
      items.set(key, value);
      return true;
    },
    remove: (key) => {
      items.delete(key);
    },
    getJson: (key, read) => {
      const raw = items.get(key);
      if (raw === undefined) return undefined;
      try {
        return read(JSON.parse(raw) as unknown);
      } catch {
        return undefined;
      }
    },
    setJson: (key, value) => {
      items.set(key, JSON.stringify(value));
      return true;
    },
    dump: () => JSON.stringify([...items]),
  };
}

/** Waits until the shell asks for a line, and returns the request. */
async function asked(shell: Shell) {
  await vi.waitFor(() => expect(shell.reads.get()).not.toBeNull());
  const request = shell.reads.get();
  if (request === null) throw new Error('no read');
  return request;
}

const text = (blocks: readonly Block[]): string => blocks.map((block) => plain(block)).join('');

describe('sudo', () => {
  it("asks for guest's password in sudo's words, with the joke said, never echoes the answer, then puts on the show and reports the incident", async () => {
    const storage = memoryStorage();
    const term = terminal();
    const h = harness({ specs: [sudo], storage, terminal: term.info });
    const job = h.shell.start('sudo ls');
    const request = await asked(h.shell);
    expect(request).toMatchObject({ prompt: '[sudo] password for guest: ', secret: true, hint: SUDO_HINT });
    expect(term.fullscreen).not.toHaveBeenCalled();

    h.shell.answerRead(request.id, SECRET);
    const result = await job.done;

    // The show: the Rick app, with the dancer's frames and the tune, after the password.
    expect(term.shown).toHaveLength(1);
    expect(term.shown[0]?.view).toBe('rick');
    const view = term.shown[0]?.props;
    expect(view?.frames).toBe(rickFrames());
    expect(view?.song).toBe(RICK_SONG);
    expect(view?.touch).toBe(false);
    expect(view?.title).toBe('You have been rickrolled');

    expect(result.status).toBe(1);
    const shown = text(result.blocks);
    expect(shown).toContain(`${SUDO_HINT}\n[sudo] password for guest: \n`);
    expect(shown).toContain('guest is not in the sudoers file. This incident will be reported.');
    // No link, no card: the video is gone.
    expect(result.blocks.some((block) => block.type === 'card')).toBe(false);
    expect(shown).not.toMatch(/youtube|http/);

    // The password reached nothing: the screen, history, storage, the app.
    expect(JSON.stringify(h.commits)).not.toContain(SECRET);
    expect(JSON.stringify(h.shell.history.list())).not.toContain(SECRET);
    expect(storage.dump()).not.toContain(SECRET);
    expect(JSON.stringify(term.shown)).not.toContain(SECRET);
    expect(h.shell.history.list().map((entry) => entry.line)).toEqual(['sudo ls']);
  });

  it('tells the app it is on a touch screen', async () => {
    const term = terminal({ touch: true });
    const h = harness({ specs: [sudo], terminal: term.info });
    const job = h.shell.start('sudo -i');
    h.shell.answerRead((await asked(h.shell)).id, '');
    await job.done;
    expect(term.shown[0]?.props.touch).toBe(true);
  });

  it('makes the sandwich after the show, and still exits 0 for it', async () => {
    const term = terminal();
    const order: string[] = [];
    term.fullscreen.mockImplementation(async () => {
      order.push('show');
      return RICK_CLOSED;
    });
    const h = harness({ specs: [sudo], terminal: term.info });
    const job = h.shell.start('sudo make me a sandwich');
    h.shell.answerRead((await asked(h.shell)).id, 'x');
    const result = await job.done;
    expect(order).toEqual(['show']);
    expect(result.status).toBe(0);
    expect(text(result.blocks)).toContain('Okay. One sandwich, made with superuser care.');
    expect(text(result.blocks)).not.toContain('incident');
  });

  it('prints the message alone where no full-screen app can show', async () => {
    const term = terminal({ fullscreen: () => Promise.reject(new Error('full-screen apps need the terminal')) });
    const h = harness({ specs: [sudo], terminal: term.info });
    const job = h.shell.start('sudo ls');
    h.shell.answerRead((await asked(h.shell)).id, 'x');
    const result = await job.done;
    expect(result.status).toBe(1);
    expect(text(result.blocks)).toContain('guest is not in the sudoers file. This incident will be reported.');
  });

  it('shows nothing when its output is not the terminal: a file gets the message only', async () => {
    const term = terminal();
    const h = harness({ specs: [sudo], terminal: term.info });
    const job = h.shell.start('sudo ls > out.txt');
    h.shell.answerRead((await asked(h.shell)).id, 'x');
    const result = await job.done;
    expect(result.status).toBe(1);
    expect(term.fullscreen).not.toHaveBeenCalled();
    expect(text(result.blocks)).toContain('guest is not in the sudoers file. This incident will be reported.');
    expect(h.fs.readFile('/home/guest/out.txt')).toBe('');
  });

  it('is interrupted by ^C while the show is up, and the prompt comes back', async () => {
    const apps = createAppRunner();
    const term = terminal({ fullscreen: (view, props, signal) => apps.open(view, props, signal) });
    const h = harness({ specs: [sudo], terminal: term.info });
    const job = h.shell.start('sudo ls');
    h.shell.answerRead((await asked(h.shell)).id, 'x');
    await vi.waitFor(() => expect(apps.request.get()?.view).toBe('rick'));
    h.shell.abort();
    const result = await job.done;
    expect(result).toMatchObject({ status: 130, interrupted: true });
    expect(apps.request.get()).toBeNull();
    expect(text(result.blocks)).not.toContain('sudoers');
  });

  it('is interrupted by ^C at the prompt, and ^D says a password is required', async () => {
    const term = terminal();
    const h = harness({ specs: [sudo], terminal: term.info });
    const job = h.shell.start('sudo ls');
    await asked(h.shell);
    h.shell.abort();
    expect(await job.done).toMatchObject({ status: 130, interrupted: true });
    expect(h.shell.reads.get()).toBeNull();
    expect(term.fullscreen).not.toHaveBeenCalled();

    const eof = h.shell.start('sudo ls');
    h.shell.answerRead((await asked(h.shell)).id, null);
    const result = await eof.done;
    expect(result.status).toBe(1);
    expect(h.commits[h.commits.length - 1]?.blocks.map((block) => plain(block)).join('')).toContain('sudo: a password is required');
    expect(term.fullscreen).not.toHaveBeenCalled();
  });

  it('needs a command, and a terminal to ask at', async () => {
    const term = terminal();
    const h = harness({ specs: [sudo], terminal: term.info });
    expect(await h.run('sudo')).toMatchObject({ status: 1 });
    expect((await h.run('sudo')).stderr).toContain('sudo: a command is required');
    const inner = await h.run('x=$(sudo ls); echo "[$x]"');
    expect(inner.stderr).toContain('sudo: a terminal is required to read the password');
    expect(h.shell.reads.get()).toBeNull();
    expect(term.fullscreen).not.toHaveBeenCalled();
  });

  it('answers --help from its spec, and passes a later --help to the command', async () => {
    const term = terminal();
    const h = harness({ specs: [sudo], terminal: term.info });
    expect((await h.run('sudo --help')).stdout).toContain('sudo [-u USER] COMMAND [ARG]...');
    const job = h.shell.start('sudo ls --help');
    expect((await asked(h.shell)).secret).toBe(true);
    h.shell.abort();
    await job.done;
  });
});

describe('reading a line', () => {
  it('echoes the prompt and the answer into the output, as a terminal does', async () => {
    const h = harness({ specs: [rm] });
    const job = h.shell.start('rm -i a.txt');
    const request = await asked(h.shell);
    expect(request).toMatchObject({ prompt: "rm: remove regular file 'a.txt'? ", secret: false, hint: null });
    h.shell.answerRead(request.id, 'y');
    const result = await job.done;
    expect(result.status).toBe(0);
    expect(text(result.blocks)).toBe("rm: remove regular file 'a.txt'? y\n");
    expect(h.fs.exists('/home/guest/a.txt')).toBe(false);
  });

  it('keeps what the command printed before it asked ahead of the question and its answer', async () => {
    const h = harness({ specs: [rm] });
    const job = h.shell.start('echo first; rm -i a.txt');
    const request = await asked(h.shell);
    h.shell.answerRead(request.id, 'n');
    expect(text((await job.done).blocks)).toBe("first\nrm: remove regular file 'a.txt'? n\n");
    expect(h.fs.exists('/home/guest/a.txt')).toBe(true);
  });
});
