import { describe, expect, it, vi } from 'vitest';
import { plain, type Block } from '../../output/model';
import type { KV, Opener } from '../../services/types';
import type { Shell } from '../../shell/index';
import { fakeOpener as openerFake } from '../../testing/opener';
import { harness } from '../../testing/shell-harness';
import rm from '../files/rm';
import sudo, { SUDO_HINT, SUDO_VIDEO } from './sudo';

const SECRET = 'hunter2-correct-horse';

function fakeOpener(result: 'opened' | 'blocked' | 'skipped' = 'opened'): Opener & { preflight: ReturnType<typeof vi.fn> } {
  const preflight = vi.fn(() => result);
  return { ...openerFake({ autoOpen: result !== 'skipped' }), preflight };
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
  it("asks for guest's password in sudo's words, with the joke said, and never echoes the answer", async () => {
    const opener = fakeOpener();
    const storage = memoryStorage();
    const h = harness({ specs: [sudo], opener, storage });
    const job = h.shell.start('sudo ls');
    const request = await asked(h.shell);
    expect(request).toMatchObject({ prompt: '[sudo] password for guest: ', secret: true, hint: SUDO_HINT });

    h.shell.answerRead(request.id, SECRET);
    // Inside the key press that answered: the video opens on a desktop browser.
    expect(opener.preflight).toHaveBeenCalledWith(SUDO_VIDEO);
    const result = await job.done;

    expect(result.status).toBe(1);
    const shown = text(result.blocks);
    expect(shown).toContain(`${SUDO_HINT}\n[sudo] password for guest: \n`);
    expect(shown).toContain('guest is not in the sudoers file. This incident will be reported.');
    expect(result.blocks.some((block) => block.type === 'card' && block.href === SUDO_VIDEO)).toBe(true);

    // The password reached nothing: the screen, history, storage.
    expect(JSON.stringify(h.commits)).not.toContain(SECRET);
    expect(JSON.stringify(h.shell.history.list())).not.toContain(SECRET);
    expect(storage.dump()).not.toContain(SECRET);
    expect(h.shell.history.list().map((entry) => entry.line)).toEqual(['sudo ls']);
  });

  it('prints the link card when the browser waits for a tap, as in Instagram', async () => {
    const opener = fakeOpener('skipped');
    const h = harness({ specs: [sudo], opener });
    const job = h.shell.start('sudo -i');
    h.shell.answerRead((await asked(h.shell)).id, '');
    const result = await job.done;
    expect(result.blocks.find((block) => block.type === 'card')).toMatchObject({ href: SUDO_VIDEO });
  });

  it('is interrupted by ^C at the prompt, and ^D says a password is required', async () => {
    const h = harness({ specs: [sudo] });
    const job = h.shell.start('sudo ls');
    await asked(h.shell);
    h.shell.abort();
    expect(await job.done).toMatchObject({ status: 130, interrupted: true });
    expect(h.shell.reads.get()).toBeNull();

    const eof = h.shell.start('sudo ls');
    h.shell.answerRead((await asked(h.shell)).id, null);
    const result = await eof.done;
    expect(result.status).toBe(1);
    expect(h.commits[h.commits.length - 1]?.blocks.map((block) => plain(block)).join('')).toContain('sudo: a password is required');
  });

  it('needs a command, and a terminal to ask at', async () => {
    const h = harness({ specs: [sudo] });
    expect(await h.run('sudo')).toMatchObject({ status: 1 });
    expect((await h.run('sudo')).stderr).toContain('sudo: a command is required');
    const inner = await h.run('x=$(sudo ls); echo "[$x]"');
    expect(inner.stderr).toContain('sudo: a terminal is required to read the password');
    expect(h.shell.reads.get()).toBeNull();
  });

  it('answers --help from its spec, and passes a later --help to the command', async () => {
    const h = harness({ specs: [sudo] });
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

  it('shows what the command printed before it asked', async () => {
    const h = harness({ specs: [rm] });
    const job = h.shell.start('echo first; rm -i a.txt');
    const request = await asked(h.shell);
    expect(text(request.before)).toBe('first\n');
    h.shell.answerRead(request.id, 'n');
    expect(text((await job.done).blocks)).toBe("first\nrm: remove regular file 'a.txt'? n\n");
    expect(h.fs.exists('/home/guest/a.txt')).toBe(true);
  });
});
