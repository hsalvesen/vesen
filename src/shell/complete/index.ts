// The completion engine, in its own chunk: the shell loads it (import('./complete/index')) once
// something subscribes to ShellPort.completion, so the first paint and the kernel never wait on
// it. One CompletionResult drives Tab, the ghost and the chips, all through one accept().

import { applyChip, chipsFor } from './chips';
import { accept, complete, extendToCommon } from './engine';
import { applyGhost, ghostFor } from './ghost';
import { answer, menuKey, pressTab, tabView } from './tab';
import type { CompletionEngine } from './types';

export { applyChip, chipsFor } from './chips';
export { cursorContext } from './context';
export { accept, complete, extendToCommon } from './engine';
export { applyGhost, ghostFor } from './ghost';
export { compareNames, didYouMean, longestCommonPrefix, matchPrefix, MAX_CANDIDATES } from './match';
export { escapeTail } from './quote';
export { ASK_ABOVE, NO_COMPLETIONS, answer, menuKey, pressTab, question, tabKey, tabView } from './tab';

export const engine: CompletionEngine = { complete, accept, extendToCommon, pressTab, menuKey, answer, ghostFor, applyGhost, chipsFor, applyChip, tabView };
