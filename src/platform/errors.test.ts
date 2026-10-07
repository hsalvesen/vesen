// The error buffer behind debug report: the last few uncaught errors, one line each.
import { describe, expect, it } from 'vitest';
import { ERROR_BUFFER_SIZE, ERROR_LINE_CHARS, installErrorBuffer } from './errors';

function errorEvent(fields: Record<string, unknown>): Event {
  return Object.assign(new Event('error'), fields);
}

describe('installErrorBuffer', () => {
  it('keeps uncaught errors and rejections, with where they came from and no query string', () => {
    const target = new EventTarget();
    const buffer = installErrorBuffer(target as unknown as Window, () => Date.UTC(2026, 9, 7, 10, 30, 5));
    target.dispatchEvent(errorEvent({ message: 'x is not defined', error: new ReferenceError('x is not defined'), filename: 'https://www.vesen.app/assets/index.js?v=1', lineno: 3, colno: 9 }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'offline' }));
    expect(buffer.recent()).toEqual([
      '10:30:05 ReferenceError: x is not defined (/assets/index.js:3:9)',
      '10:30:05 unhandled rejection: offline',
    ]);
    buffer.stop();
    target.dispatchEvent(errorEvent({ message: 'after' }));
    expect(buffer.recent()).toHaveLength(2);
  });

  it('keeps only the newest few, each one line and short', () => {
    const target = new EventTarget();
    const buffer = installErrorBuffer(target as unknown as Window, () => 0);
    for (let i = 0; i < ERROR_BUFFER_SIZE + 3; i += 1) target.dispatchEvent(errorEvent({ message: `e${i}\nmore` }));
    target.dispatchEvent(errorEvent({ message: 'y'.repeat(1000) }));
    const recent = buffer.recent();
    expect(recent).toHaveLength(ERROR_BUFFER_SIZE);
    expect(recent[0]).toBe('00:00:00 e4 more');
    expect(recent[recent.length - 1]?.length).toBe(ERROR_LINE_CHARS);
  });
});
