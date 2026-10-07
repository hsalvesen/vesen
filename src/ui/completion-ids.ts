// The ids that tie the prompt to the list of completions under it, for aria-controls and
// aria-activedescendant. Kept apart from CompletionRow and the dock's ChipRow, which draw the
// list, so the prompt, which the first paint draws, does not pull either into its chunk.

/** The listbox's id, for the input's aria-controls. */
export const COMPLETION_LIST_ID = 'completion-list';

/** The id of the option at `index`, for the input's aria-activedescendant. */
export function optionId(index: number): string {
  return `${COMPLETION_LIST_ID}-${index}`;
}
