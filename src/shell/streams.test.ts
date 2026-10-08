import { describe, expect, it } from 'vitest';
import { lineText, out } from '../output/model';
import { VfsError, type VirtualFile } from '../vfs/types';
import { Vfs } from '../vfs/vfs';
import {
  AsyncPipe,
  CaptureOut,
  FileOut,
  JobDetached,
  NullOut,
  PIPE_HIGH_WATER,
  PipeIn,
  PipeOut,
  StringIn,
  TtyIn,
  TtyOut,
  TtySink,
  vfsWriteTarget,
} from './streams';
import { BrokenPipe } from './types';

/** Lets every settled promise run its callbacks. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function state<T>(promise: Promise<T>): { settled: boolean; error?: unknown } {
  const seen: { settled: boolean; error?: unknown } = { settled: false };
  promise.then(
    () => (seen.settled = true),
    (error: unknown) => {
      seen.settled = true;
      seen.error = error;
    },
  );
  return seen;
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('AsyncPipe', () => {
  it('resolves writes at once below the high-water mark, and makes the writer wait above it', async () => {
    const pipe = new AsyncPipe(10);
    const small = state(pipe.write('12345'));
    await flush();
    expect(small.settled).toBe(true);

    const big = state(pipe.write('6789012345'));
    await flush();
    expect(big.settled).toBe(false);
    expect(pipe.size).toBe(15);

    expect(await pipe.read()).toBe('12345');
    await flush();
    expect(big.settled).toBe(true);
    expect(big.error).toBeUndefined();
  });

  it('uses 64 KiB by default', () => {
    expect(new AsyncPipe().highWater).toBe(PIPE_HIGH_WATER);
    expect(PIPE_HIGH_WATER).toBe(65_536);
  });

  it('gives the reader null at the end of input, after what was written', async () => {
    const pipe = new AsyncPipe();
    await pipe.write('a');
    pipe.closeWrite();
    expect(await pipe.read()).toBe('a');
    expect(await pipe.read()).toBeNull();
  });

  it('wakes a waiting reader when data or the end arrives', async () => {
    const pipe = new AsyncPipe();
    const first = pipe.read();
    await pipe.write('x');
    expect(await first).toBe('x');
    const second = pipe.read();
    pipe.closeWrite();
    expect(await second).toBeNull();
  });

  it('rejects the waiting writer and every later write with BrokenPipe once the reader goes (EPIPE)', async () => {
    const pipe = new AsyncPipe(4);
    const waiting = state(pipe.write('123456'));
    pipe.closeRead();
    await flush();
    expect(waiting.error).toBeInstanceOf(BrokenPipe);
    await expect(pipe.write('more')).rejects.toBeInstanceOf(BrokenPipe);
    expect(pipe.broken).toBe(true);
    expect(pipe.size).toBe(0);
  });
});

describe('in streams', () => {
  it('splits a pipe into lines across chunk boundaries', async () => {
    const pipe = new AsyncPipe();
    const reader = new PipeIn(pipe);
    const lines = collect(reader.lines());
    await pipe.write('one\ntw');
    await pipe.write('o\nthree');
    pipe.closeWrite();
    expect(await lines).toEqual(['one', 'two', 'three']);
  });

  it('reads all of a pipe as text, and closing it breaks the pipe for the writer', async () => {
    const pipe = new AsyncPipe();
    const reader = new PipeIn(pipe);
    await pipe.write('a\n');
    pipe.closeWrite();
    expect(await reader.text()).toBe('a\n');
    reader.close();
    expect(pipe.broken).toBe(true);
  });

  it('reads a string once, as text or lines', async () => {
    expect(await new StringIn('x\ny\n').text()).toBe('x\ny\n');
    expect(await collect(new StringIn('x\ny\n').lines())).toEqual(['x', 'y']);
    const once = new StringIn('z');
    await once.text();
    expect(await once.text()).toBe('');
  });

  it('reads the terminal as empty for now', async () => {
    const tty = new TtyIn();
    expect(tty.isTTY).toBe(true);
    expect(await tty.text()).toBe('');
    expect(await collect(tty.lines())).toEqual([]);
    expect(await collect(tty.chunks())).toEqual([]);
  });

  it('hands over chunks as written, so a missing final newline stays missing', async () => {
    const pipe = new AsyncPipe();
    const chunks = collect(new PipeIn(pipe).chunks());
    await pipe.write('one\ntw');
    await pipe.write('o');
    pipe.closeWrite();
    expect(await chunks).toEqual(['one\ntw', 'o']);
    expect(await collect(new StringIn('no end').chunks())).toEqual(['no end']);
    expect(await collect(new StringIn('').chunks())).toEqual([]);
  });
});

describe('out streams off the screen', () => {
  it('turn spans and blocks into plain text', async () => {
    const capture = new CaptureOut();
    await capture.line('a ', out.run('tap', 'ls', { fg: 'accent' }));
    await capture.block(out.grid([out.span('x'), out.span('y')]));
    await capture.block(out.chips([{ label: 'c', action: out.action.run('c') }]));
    expect(capture.text).toBe('a tap\nx\ny\n');
    expect(capture.isTTY).toBe(false);
    expect(capture.columns).toBe(80);
  });

  it('write into a pipe, and nowhere for /dev/null', async () => {
    const pipe = new AsyncPipe();
    await new PipeOut(pipe).write('p');
    expect(await pipe.read()).toBe('p');
    await expect(new NullOut().write('gone')).resolves.toBeUndefined();
  });
});

function home(): { fs: Vfs } {
  const tree = (): VirtualFile => ({
    name: '',
    type: 'directory',
    children: { home: { name: 'home', type: 'directory', owner: 'guest', children: { f: { name: 'f', type: 'file', content: 'old\n' } } } },
  });
  return { fs: new Vfs({ seed: tree }) };
}

describe('redirection targets', () => {
  it('truncate on open for >, as the shell does before the command runs', () => {
    const { fs } = home();
    const handle = vfsWriteTarget(fs).open('/home/f', { append: false, noclobber: false });
    expect(fs.readFile('/home/f')).toBe('');
    handle.write('a');
    handle.write('b');
    handle.close();
    expect(fs.readFile('/home/f')).toBe('ab');
  });

  it('append for >>, creating the file when it is missing', () => {
    const { fs } = home();
    vfsWriteTarget(fs).open('/home/f', { append: true, noclobber: false }).write('more\n');
    vfsWriteTarget(fs).open('/home/new', { append: true, noclobber: false }).write('x');
    expect(fs.readFile('/home/f')).toBe('old\nmore\n');
    expect(fs.readFile('/home/new')).toBe('x');
  });

  it('refuse to overwrite with noclobber, and fail in a missing folder', () => {
    const { fs } = home();
    expect(() => vfsWriteTarget(fs).open('/home/f', { append: false, noclobber: true })).toThrow(VfsError);
    expect(fs.readFile('/home/f')).toBe('old\n');
    expect(() => vfsWriteTarget(fs).open('/nope/f', { append: false, noclobber: false })).toThrow(/ENOENT/);
  });

  it('report a failed write through the stream', async () => {
    const file = new FileOut({
      write: () => {
        throw new VfsError('ENOSPC', '/home/f');
      },
      close: () => {},
    });
    await expect(file.write('x')).rejects.toBeInstanceOf(VfsError);
    file.close();
    await expect(file.write('x')).resolves.toBeUndefined();
  });
});

describe('the screen', () => {
  const cols = () => 80;

  it('collects text through the SGR reader into one lines block per run of a stream', async () => {
    const sink = new TtySink();
    const stdout = new TtyOut(sink, 'stdout', cols);
    const stderr = new TtyOut(sink, 'stderr', cols);
    await stdout.write('a\n\u001b[31mb');
    await stdout.write('c\n');
    await stderr.write('oops\n');
    await stdout.line('d');
    const { blocks, screen } = sink.finish();
    expect(screen).toBe('keep');
    expect(blocks).toEqual([
      { type: 'lines', stream: 'stdout', lines: [[{ text: 'a' }], [{ text: 'bc', style: { fg: 'red' } }]] },
      { type: 'lines', stream: 'stderr', lines: [[{ text: 'oops' }]] },
      { type: 'lines', stream: 'stdout', lines: [[{ text: 'd' }]] },
    ]);
  });

  it('ends an unfinished line before a block, so output keeps its order', async () => {
    const sink = new TtySink();
    const stdout = new TtyOut(sink, 'stdout', cols);
    await stdout.write('partial');
    await stdout.block(out.panel('warn', [[out.span('note')]]));
    await stdout.write('after');
    const { blocks } = sink.finish();
    expect(blocks.map((block) => block.type)).toEqual(['lines', 'panel', 'lines']);
    expect(blocks[2]?.type === 'lines' && blocks[2].lines.map(lineText)).toEqual(['after']);
  });

  it('keeps spans, styles and actions from line() and blocks', async () => {
    const sink = new TtySink();
    const span = out.run('ls', 'ls');
    await new TtyOut(sink, 'stdout', cols).line('try ', span);
    const [block] = sink.finish().blocks;
    expect(block?.type === 'lines' && block.lines[0]?.[1]).toBe(span);
  });

  it('drops everything before a clear, from the effect or from ESC[2J', async () => {
    const sink = new TtySink();
    const stdout = new TtyOut(sink, 'stdout', cols);
    await stdout.write('one\n');
    sink.clear();
    await stdout.write('two\n\u001b[2Jthree\n');
    const { blocks, screen } = sink.finish();
    expect(screen).toBe('clear');
    expect(blocks.flatMap((block) => (block.type === 'lines' ? block.lines.map(lineText) : []))).toEqual(['three']);
  });

  it('marks a reset, which the host answers with the banner', () => {
    const sink = new TtySink();
    sink.reset();
    expect(sink.finish().screen).toBe('reset');
  });

  it('rejects writes once sealed, so a job that was interrupted cannot add output', async () => {
    const sink = new TtySink();
    const stdout = new TtyOut(sink, 'stdout', cols);
    await stdout.write('kept');
    sink.seal();
    await expect(stdout.write('late')).rejects.toBeInstanceOf(JobDetached);
    await expect(stdout.line('late')).rejects.toBeInstanceOf(JobDetached);
    await expect(stdout.block(out.text('late'))).rejects.toBeInstanceOf(JobDetached);
    expect(sink.finish().blocks).toEqual([{ type: 'lines', stream: 'stdout', lines: [[{ text: 'kept' }]] }]);
  });

  describe('^C', () => {
    const texts = (sink: TtySink) => sink.finish().blocks.flatMap((block) => (block.type === 'lines' ? block.lines.map(lineText) : []));

    it('goes where the output had got to, before what the command writes on its way out', async () => {
      const sink = new TtySink();
      const stdout = new TtyOut(sink, 'stdout', cols);
      await stdout.write('reply 1\nreply 2\n');
      sink.caret();
      // ping's statistics start with a newline, which ends the caret's line.
      await stdout.write('\n--- statistics ---\n');
      expect(texts(sink)).toEqual(['reply 1', 'reply 2', '^C', '--- statistics ---']);
    });

    it('ends an unfinished line as a terminal echoes it, plain whatever its style', async () => {
      const sink = new TtySink();
      await new TtyOut(sink, 'stdout', cols).write('\u001b[31mhalf');
      sink.caret();
      expect(sink.view().blocks).toEqual([{ type: 'lines', stream: 'stdout', lines: [[{ text: 'half', style: { fg: 'red' } }, { text: '^C' }]] }]);
      expect(texts(sink)).toEqual(['half^C']);
    });

    it('starts a line of its own after an unfinished error', async () => {
      const sink = new TtySink();
      await new TtyOut(sink, 'stderr', cols).write('oops');
      sink.caret();
      const { blocks } = sink.finish();
      expect(blocks).toEqual([
        { type: 'lines', stream: 'stderr', lines: [[{ text: 'oops' }]] },
        { type: 'lines', stream: 'stdout', lines: [[{ text: '^C' }]] },
      ]);
    });

    it('still shows after the output was cut short, and not once sealed', async () => {
      const sink = new TtySink({ maxLines: 2 });
      await new TtyOut(sink, 'stdout', cols).write('1\n2\n3\n');
      sink.caret();
      sink.seal();
      sink.caret();
      expect(texts(sink)).toEqual(['1', '2', '[output truncated]', '^C']);
    });
  });

  it('stops after the line limit with one notice', async () => {
    const sink = new TtySink({ maxLines: 3 });
    await new TtyOut(sink, 'stdout', cols).write('1\n2\n3\n4\n5\n');
    const text = sink.finish().blocks.flatMap((block) => (block.type === 'lines' ? block.lines.map(lineText) : []));
    expect(text).toEqual(['1', '2', '3', '[output truncated]']);
  });

  it('stops after the character limit too, so one endless line cannot freeze the page', async () => {
    const text = (sink: TtySink) => sink.finish().blocks.flatMap((block) => (block.type === 'lines' ? block.lines.map(lineText) : []));
    const long = new TtySink({ maxChars: 10 });
    const stdout = new TtyOut(long, 'stdout', cols);
    await stdout.write('12345\n');
    await stdout.write('x'.repeat(4));
    await stdout.write('y'.repeat(100));
    await stdout.write('more\n');
    await stdout.line('and more');
    expect(text(long)).toEqual(['12345', '[output truncated]']);

    const lines = new TtySink({ maxChars: 10 });
    await new TtyOut(lines, 'stdout', cols).line('123456');
    await new TtyOut(lines, 'stderr', cols).line('7890ab');
    expect(text(lines)).toEqual(['123456', '[output truncated]']);
  });

  it('lets the browser run between many small lines and blocks too', async () => {
    let yields = 0;
    const sink = new TtySink({
      yieldToHost: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    const stdout = new TtyOut(sink, 'stdout', cols);
    for (let i = 0; i < 2000; i += 1) await stdout.line('y'.repeat(30));
    for (let i = 0; i < 200; i += 1) await stdout.block(out.text('z'));
    expect(yields).toBeGreaterThanOrEqual(3);
  });

  it('tells the kernel about stderr writes, for the bell', async () => {
    let rings = 0;
    const sink = new TtySink({ onStderr: () => (rings += 1) });
    await new TtyOut(sink, 'stdout', cols).write('fine\n');
    await new TtyOut(sink, 'stderr', cols).write('bad\n');
    expect(rings).toBe(1);
  });

  it('lets the browser run between large writes', async () => {
    let yields = 0;
    const sink = new TtySink({
      yieldToHost: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    const stdout = new TtyOut(sink, 'stdout', cols);
    for (let i = 0; i < 100; i += 1) await stdout.write(`${'y'.repeat(1023)}\n`);
    expect(yields).toBeGreaterThanOrEqual(2);
  });
});

describe('the screen while the job runs', () => {
  const cols = () => 80;

  it('says when its output changes, and never once sealed', async () => {
    let changes = 0;
    const sink = new TtySink({ onChange: () => (changes += 1) });
    const stdout = new TtyOut(sink, 'stdout', cols);
    await stdout.write('a\n');
    await stdout.line('b');
    await stdout.block(out.panel('warn', [[out.span('note')]]));
    sink.clear();
    expect(changes).toBe(4);
    sink.seal();
    await stdout.write('late\n').catch(() => {});
    sink.clear();
    expect(changes).toBe(4);
  });

  it('shows a line still being written as far as it has got, and the sink keeps its own copy', async () => {
    const sink = new TtySink();
    const stdout = new TtyOut(sink, 'stdout', cols);
    await stdout.write('done\nhalf');
    const view = sink.view();
    expect(view.blocks).toEqual([{ type: 'lines', stream: 'stdout', lines: [[{ text: 'done' }], [{ text: 'half' }]] }]);
    await stdout.write(' and the rest\n');
    // The earlier view is a copy: it does not change under the screen.
    expect(view.blocks[0]?.type === 'lines' && view.blocks[0].lines.map(lineText)).toEqual(['done', 'half']);
    const [now] = sink.view().blocks;
    expect(now?.type === 'lines' && now.lines.map(lineText)).toEqual(['done', 'half and the rest']);
  });

  it('puts an unfinished line on another stream in a block of its own', async () => {
    const sink = new TtySink();
    await new TtyOut(sink, 'stdout', cols).write('out\n');
    await new TtyOut(sink, 'stderr', cols).write('err, so far');
    expect(sink.view().blocks).toEqual([
      { type: 'lines', stream: 'stdout', lines: [[{ text: 'out' }]] },
      { type: 'lines', stream: 'stderr', lines: [[{ text: 'err, so far' }]] },
    ]);
  });

  it('counts the clears and resets, so the screen can wipe itself once for each', async () => {
    const sink = new TtySink();
    const stdout = new TtyOut(sink, 'stdout', cols);
    expect(sink.view()).toMatchObject({ screen: 'keep', clears: 0 });
    await stdout.write('a\n\u001b[2Jb\n');
    expect(sink.view()).toMatchObject({ screen: 'clear', clears: 1 });
    sink.reset();
    await stdout.write('c\n');
    const view = sink.view();
    expect(view).toMatchObject({ screen: 'reset', clears: 2 });
    expect(view.blocks).toEqual([{ type: 'lines', stream: 'stdout', lines: [[{ text: 'c' }]] }]);
  });
});
