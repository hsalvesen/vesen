export class EPIPE extends Error { constructor() { super('EPIPE'); this.name = 'EPIPE'; } }
export interface ReadStream { readonly isTTY: boolean; read(): Promise<string | null>; text(): Promise<string>; lines(): AsyncIterable<string>; close(): void }
export interface WriteStream { readonly isTTY: boolean; readonly columns: number; write(s: string): void | Promise<void>; end(): void }
// Bounded in-memory pipe: writer awaits when buffer exceeds HIGH_WATER; reader close => EPIPE on next write.
export function createPipe(highWater = 64 * 1024): { r: ReadStream; w: WriteStream } {
  const q: string[] = []; let size = 0; let ended = false; let readerClosed = false;
  let wakeReader: (() => void) | null = null; let wakeWriter: (() => void) | null = null;
  const r: ReadStream = {
    isTTY: false,
    async read() {
      while (!q.length && !ended) await new Promise<void>(res => (wakeReader = res));
      if (!q.length) return null;
      const s = q.shift()!; size -= s.length; wakeWriter?.(); wakeWriter = null; return s;
    },
    async text() { let out = ''; for (let c; (c = await r.read()) !== null;) out += c; return out; },
    async *lines() { let buf = ''; for (let c; (c = await r.read()) !== null;) { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { yield buf.slice(0, i); buf = buf.slice(i + 1); } } if (buf) yield buf; },
    close() { readerClosed = true; q.length = 0; size = 0; wakeWriter?.(); },
  };
  const w: WriteStream = {
    isTTY: false, columns: 80,
    async write(s) {
      if (readerClosed) throw new EPIPE();
      q.push(s); size += s.length; wakeReader?.(); wakeReader = null;
      while (size > highWater && !readerClosed) await new Promise<void>(res => (wakeWriter = res));
      if (readerClosed) throw new EPIPE();
    },
    end() { ended = true; wakeReader?.(); wakeReader = null; },
  };
  return { r, w };
}
export const emptyStdin: ReadStream = { isTTY: true, async read() { return null; }, async text() { return ''; }, async *lines() {}, close() {} };
export function collector(isTTY = true): WriteStream & { out: string } {
  const c = { out: '', isTTY, columns: 80, write(s: string) { c.out += s; }, end() {} }; return c;
}
