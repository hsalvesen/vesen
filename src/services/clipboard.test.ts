// Copy (designs/phone-and-instagram.md, "G"): the Clipboard API, then execCommand, then false.
import { describe, expect, it, vi } from 'vitest';
import { copyWithCommand, createClipboard } from './clipboard';

/** Just enough of a document for the execCommand fallback. */
function fakeDocument(copies: boolean | 'throw') {
  const appended: { value: string; removed: boolean }[] = [];
  const focus = vi.fn();
  const active = { focus };
  const doc = {
    body: {
      append: (area: { value: string; removed: boolean }) => appended.push(area),
    },
    activeElement: active,
    createElement: () => {
      const area = {
        value: '',
        removed: false,
        style: { cssText: '' },
        setAttribute: () => {},
        select: () => {},
        setSelectionRange: () => {},
        remove() {
          area.removed = true;
        },
      };
      return area;
    },
    execCommand: vi.fn(() => {
      if (copies === 'throw') throw new Error('no');
      return copies;
    }),
  };
  return { doc: doc as unknown as Document, appended, focus };
}

describe('clipboard', () => {
  it('uses the Clipboard API when it can', async () => {
    const writeText = vi.fn(async () => {});
    const { doc } = fakeDocument(true);
    expect(await createClipboard({ navigator: { clipboard: { writeText } }, document: doc }).copy('has@salvesen.app')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('has@salvesen.app');
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand, then gives focus back and leaves nothing behind', async () => {
    const { doc, appended, focus } = fakeDocument(true);
    const denied = vi.fn(async () => {
      throw new Error('denied');
    });
    expect(await createClipboard({ navigator: { clipboard: { writeText: denied } }, document: doc }).copy('x')).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(appended).toEqual([{ value: 'x', removed: true, style: expect.anything(), setAttribute: expect.anything(), select: expect.anything(), setSelectionRange: expect.anything(), remove: expect.anything() }]);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('says false when neither way works', async () => {
    expect(await createClipboard({ document: fakeDocument(false).doc }).copy('x')).toBe(false);
    expect(await createClipboard({ document: fakeDocument('throw').doc }).copy('x')).toBe(false);
    expect(await createClipboard({}).copy('x')).toBe(false);
    expect(copyWithCommand(undefined, 'x')).toBe(false);
  });
});
