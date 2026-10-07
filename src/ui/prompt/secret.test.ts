import { describe, expect, it } from 'vitest';
import { secretEdit, secretMerge } from './secret';

describe('secretEdit', () => {
  it.each<[string, string, number, number, string, string, number]>([
    ['insertText', 'x', 2, 2, 'abcd', 'abxcd', 3],
    ['insertFromPaste', 'one\ntwo', 4, 4, 'abcd', 'abcdonetwo', 10],
    ['insertText', 'Z', 1, 3, 'abcd', 'aZd', 2],
    ['deleteContentBackward', '', 2, 2, 'abcd', 'acd', 1],
    ['deleteContentForward', '', 2, 2, 'abcd', 'abd', 2],
    ['deleteContentBackward', '', 1, 3, 'abcd', 'ad', 1],
    ['deleteWordBackward', '', 9, 9, 'pass word', 'pass ', 5],
    ['deleteWordForward', '', 0, 0, 'pass word', ' word', 0],
    ['deleteSoftLineBackward', '', 3, 3, 'abcd', 'd', 0],
    ['deleteHardLineForward', '', 1, 1, 'abcd', 'a', 1],
    ['deleteByCut', '', 1, 2, 'abcd', 'acd', 1],
  ])('%s %j at [%i, %i) of %j gives %j', (type, data, start, end, secret, text, cursor) => {
    expect(secretEdit(type, data, secret, start, end)).toEqual({ text, cursor });
  });

  it('does nothing for undo, redo or formatting', () => {
    for (const type of ['historyUndo', 'historyRedo', 'formatBold']) expect(secretEdit(type, '', 'abcd', 4, 4)).toBeNull();
  });

  it('deletes a surrogate pair as one character', () => {
    expect(secretEdit('deleteContentBackward', '', 'a😀', 3, 3)).toEqual({ text: 'a', cursor: 1 });
  });
});

describe('secretMerge', () => {
  it('takes what an input method added under the mask, and says real text reached the input', () => {
    expect(secretMerge('ab', '••', '••cd', '•')).toEqual({ state: { text: 'abcd', cursor: 4 }, added: true });
  });

  it('drops mask characters an undo brought back, which stand for nothing it can know', () => {
    expect(secretMerge('ab', '••', '•••••', '•')).toEqual({ state: { text: 'ab', cursor: 2 }, added: false });
    expect(secretMerge('abc', '•••', '•', '•')).toEqual({ state: { text: 'a', cursor: 1 }, added: false });
  });
});
