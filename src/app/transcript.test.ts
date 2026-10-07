import { describe, expect, it } from 'vitest';
import { lineText, out, type Block, type Line } from '../output/model';
import type { ScreenCommit, ScreenStart } from '../shell/index';
import type { LiveOutput } from '../shell/streams';
import { promptText } from '../shell/prompt';
import { stubCommands } from '../testing/shell-harness';
import { createScreen, type ScreenEntry } from '../stores/screen';
import { createAppShell } from './shell';
import { transcriptScreen } from './transcript';

const PROMPT: Line = [{ text: 'guest@vesen:~$' }];

/** A frame scheduler that runs only when told, so a test sees what waits for the next frame. */
function frames() {
  const queue: (() => void)[] = [];
  return {
    frame: (work: () => void) => void queue.push(work),
    get pending() {
      return queue.length;
    },
    run() {
      for (const work of queue.splice(0)) work();
    },
  };
}

/** What an entry shows: its prompt and line, then its output's text. */
function shown(entry: ScreenEntry | undefined): string[] {
  if (entry === undefined) return [];
  const rows = entry.prompt === null ? [] : [`${promptText(entry.prompt)} ${entry.line}`];
  for (const block of entry.blocks) {
    if (block.type === 'lines') rows.push(...block.lines.map(lineText));
    else if (block.type === 'legacyHtml') rows.push(`<html>${block.html}`);
  }
  return rows;
}

/** A job as the kernel begins it: its output is whatever the test sets. */
function job(id: number, line: string, extra: Partial<ScreenStart> = {}) {
  let output: LiveOutput = { blocks: [], screen: 'keep', clears: 0 };
  const start: ScreenStart = { id, line, origin: 'keyboard', prompt: PROMPT, startedAt: 10, output: () => output, ...extra };
  return {
    start,
    write(blocks: readonly Block[], screen: LiveOutput['screen'] = output.screen, clears = output.clears) {
      output = { blocks, screen, clears };
    },
    commit(result: Partial<ScreenCommit> = {}): ScreenCommit {
      return {
        id,
        line,
        origin: 'keyboard',
        prompt: PROMPT,
        startedAt: 10,
        endedAt: 20,
        status: 0,
        interrupted: false,
        screen: output.screen,
        blocks: output.blocks,
        ...result,
      };
    },
  };
}

function setup() {
  const screen = createScreen(() => 5);
  const clock = frames();
  const sink = transcriptScreen(screen, () => 'BANNER', () => PROMPT, { frame: clock.frame });
  return { screen, clock, sink };
}

describe('the transcript as a streaming screen', () => {
  it('puts the line on the screen the moment it starts, running, with no output yet', () => {
    const { screen, sink } = setup();
    sink.begin?.(job(3, 'sleep 5').start);
    expect(screen.entries()).toEqual([
      expect.objectContaining({ prompt: PROMPT, line: 'sleep 5', blocks: [], state: 'running', job: 3, startedAt: 10 }),
    ]);
  });

  it('draws what the job writes once a frame, however often it writes', () => {
    const { screen, sink, clock } = setup();
    const sleep = job(3, 'yes | head -n 3');
    sink.begin?.(sleep.start);
    for (const count of [1, 2, 3]) {
      sleep.write([out.lines(Array.from({ length: count }, (): Line => [out.span('y')]))]);
      sink.changed?.(3);
    }
    expect(clock.pending).toBe(1);
    expect(shown(screen.entries()[0])).toEqual(['guest@vesen:~$ yes | head -n 3']);
    clock.run();
    expect(shown(screen.entries()[0])).toEqual(['guest@vesen:~$ yes | head -n 3', 'y', 'y', 'y']);
    expect(screen.entries()[0]?.state).toBe('running');
  });

  it('records how the line ended in the same entry, and draws nothing after that', () => {
    const { screen, sink, clock } = setup();
    const sleep = job(3, 'sleep 5');
    sink.begin?.(sleep.start);
    sleep.write([out.text('half')]);
    sink.changed?.(3);
    sink.commit(sleep.commit({ interrupted: true, status: 130, blocks: [out.text('half'), out.text('^C')] }));
    clock.run();
    expect(screen.entries()).toHaveLength(1);
    expect(screen.entries()[0]).toMatchObject({ state: 'interrupted', status: 130, endedAt: 20, job: undefined });
    expect(shown(screen.entries()[0])).toEqual(['guest@vesen:~$ sleep 5', 'half', '^C']);
  });

  it('wipes the screen when the job clears it, taking its own prompt line too', () => {
    const { screen, sink, clock } = setup();
    screen.push({ prompt: PROMPT, line: 'echo old', blocks: [out.text('old')] });
    const clear = job(4, 'sleep 1; clear; echo new');
    sink.begin?.(clear.start);
    clear.write([out.text('new')], 'clear', 1);
    sink.changed?.(4);
    clock.run();
    expect(screen.entries().map(shown)).toEqual([['new']]);
    // Done, with nothing more cleared: no second wipe takes anything typed since.
    screen.push({ prompt: null, line: '', blocks: [out.text('a notice')] }, { before: screen.entries()[0]?.id ?? 0 });
    sink.commit(clear.commit());
    expect(screen.entries().map(shown)).toEqual([['a notice'], ['new']]);
  });

  it('puts the banner back for reset, before the line that reset', () => {
    const { screen, sink } = setup();
    screen.push({ prompt: PROMPT, line: 'echo old', blocks: [out.text('old')] });
    const reset = job(5, 'reset');
    sink.begin?.(reset.start);
    reset.write([], 'reset', 1);
    // Finished before the next frame: the commit does the wipe.
    sink.commit(reset.commit());
    expect(screen.entries().map(shown)).toEqual([['guest@vesen:~$ banner', '<html>BANNER']]);
  });

  it('carries on with the entry a line typed before the kernel arrived already has', () => {
    const screen = createScreen();
    const waiting = transcriptScreen(screen, () => '', () => PROMPT, { frame: () => {} });
    const kernel = transcriptScreen(screen, () => '', () => PROMPT, { frame: (work) => work() });
    waiting.begin?.(job(-1, 'ls').start);
    const ls = job(1, 'ls', { continues: -1 });
    kernel.begin?.(ls.start);
    ls.write([out.text('README.md')]);
    kernel.changed?.(1);
    kernel.commit(ls.commit());
    expect(screen.entries().map(shown)).toEqual([['guest@vesen:~$ ls', 'README.md']]);
    expect(screen.entries()[0]?.state).toBe('done');
  });

  it('leaves an entry taken off the screen off, and records a line it never saw begin', () => {
    const { screen, sink } = setup();
    const gone = job(6, 'sleep 5');
    sink.begin?.(gone.start);
    screen.clear();
    sink.commit(gone.commit({ interrupted: true }));
    expect(screen.entries()).toEqual([]);
    sink.commit(job(7, 'echo hi').commit({ blocks: [out.text('hi')] }));
    expect(screen.entries().map(shown)).toEqual([['guest@vesen:~$ echo hi', 'hi']]);
  });
});

describe('a line in the app shell', () => {
  it('is on the screen at once, and its output arrives as the job writes it', async () => {
    const screen = createScreen();
    const clock = frames();
    const app = createAppShell({ banner: () => 'BANNER', specs: stubCommands(), screen, version: '2.0.0', frame: clock.frame, yieldToHost: () => Promise.resolve() });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    app.shell.registry.register({
      name: 'slow',
      category: 'shell',
      summary: 'writes, waits, writes',
      async run(ctx) {
        await ctx.stdout.line('first');
        await gate;
        await ctx.stdout.line('second');
        return 0;
      },
    });
    const done = app.shell.run('slow');
    expect(shown(screen.entries()[0])).toEqual(['guest@vesen:~$ slow']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.run();
    expect(shown(screen.entries()[0])).toEqual(['guest@vesen:~$ slow', 'first']);
    expect(screen.entries()[0]?.state).toBe('running');
    release();
    await done;
    expect(shown(screen.entries()[0])).toEqual(['guest@vesen:~$ slow', 'first', 'second']);
    expect(screen.entries()[0]?.state).toBe('done');
    app.stop();
  });
});
