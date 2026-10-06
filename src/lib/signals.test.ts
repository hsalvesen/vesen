import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeadlineExceeded, combineSignals, deadline, isAbortError, whenAborted } from './signals';

afterEach(() => {
  vi.useRealTimers();
});

describe('deadline', () => {
  it('aborts with DeadlineExceeded after its time, unless cancelled', async () => {
    vi.useFakeTimers();
    const timer = deadline(1000);
    const cancelled = deadline(1000);
    cancelled.cancel();
    await vi.advanceTimersByTimeAsync(999);
    expect(timer.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(timer.signal.reason).toBeInstanceOf(DeadlineExceeded);
    expect((timer.signal.reason as DeadlineExceeded).ms).toBe(1000);
    expect(cancelled.signal.aborted).toBe(false);
  });

  it('combines with another signal, either one aborting the result', () => {
    const line = new AbortController();
    const budget = deadline(60_000);
    const combined = combineSignals(line.signal, budget.signal);
    line.abort('^C');
    expect(combined.reason).toBe('^C');
    budget.cancel();
  });
});

describe('whenAborted', () => {
  it('resolves with the reason, at once for a signal already aborted', async () => {
    const controller = new AbortController();
    const waiting = whenAborted(controller.signal);
    controller.abort('why');
    await expect(waiting).resolves.toBe('why');
    await expect(whenAborted(controller.signal)).resolves.toBe('why');
  });
});

describe('isAbortError', () => {
  it('recognises an AbortError by name', () => {
    expect(isAbortError(new DOMException('stop', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
