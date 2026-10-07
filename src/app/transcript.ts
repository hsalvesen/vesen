// The transcript as the shell's screen (docs/plan/designs/shell-architecture.md, section 2, step
// 9; F013). A line's entry goes on the screen the moment it starts, in the 'running' state, with
// the prompt it was typed at; what the job writes is drawn into it at most once a frame, however
// many lines it writes in between; and when the job ends the entry records how. A job that clears
// the screen (clear, ESC[2J) or resets it takes everything else off the screen as it does so, and
// its own prompt line with it, as a terminal's clear does; reset puts the banner back first.
//
// It reads nothing of the kernel but types, so the initial chunk uses it for a line typed before
// the kernel has arrived (app/lazy-shell.ts), and the kernel carries on with that line's entry.

import type { Block, Line } from '../output/model';
import type { ScreenCommit, ScreenSink, ScreenStart } from '../shell/index';
import type { LiveOutput, ScreenAction } from '../shell/streams';
import type { ScreenEntry, ScreenStore } from '../stores/screen';

/** Runs `work` before the next paint; a timer where there are no animation frames. */
export type FrameScheduler = (work: () => void) => void;

/** The browser's next animation frame, or a frame's worth of time where there is none. */
export const nextFrame: FrameScheduler = (work) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => work());
  else setTimeout(work, 16);
};

/** The welcome banner's blocks, at the width the terminal has when it is drawn. */
export type Banner = () => readonly Block[];

/** The banner entry, as boot and `reset` show it, typed at `prompt`. */
export function bannerEntry(screen: ScreenStore, banner: Banner, prompt: Line, before?: number): void {
  screen.push({ prompt, line: 'banner', blocks: banner(), origin: 'boot', status: 0 }, before === undefined ? {} : { before });
}

/** A running job, as the transcript keeps track of it. */
interface Live {
  readonly start: ScreenStart;
  /** The clears already shown. */
  clears: number;
  /** A redraw is waiting for the next frame. */
  queued: boolean;
}

export interface TranscriptOptions {
  /** When a running job's output is drawn; the next animation frame by default. */
  readonly frame?: FrameScheduler;
}

/** The transcript as the shell's screen: each line's entry, from the moment it starts. */
export function transcriptScreen(
  screen: ScreenStore,
  banner: Banner,
  renderPrompt: () => Line,
  options: TranscriptOptions = {},
): ScreenSink {
  const frame = options.frame ?? nextFrame;
  const live = new Map<number, Live>();

  /** The running entry job `job` writes to; the newest, if an old one somehow has the same id. */
  const entryOf = (job: number): ScreenEntry | undefined => {
    const entries = screen.entries();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i] as ScreenEntry;
      if (entry.job === job && entry.state === 'running') return entry;
    }
    return undefined;
  };

  /**
   * The job cleared or reset the screen: everything else goes, and the prompt line it was typed
   * at with it; its output so far was cleared in the sink. Reset puts the banner back first.
   */
  const wipe = (entry: ScreenEntry, action: Exclude<ScreenAction, 'keep'>): void => {
    screen.clear((other) => other.id === entry.id);
    screen.update(entry.id, { prompt: null });
    if (action === 'reset') bannerEntry(screen, banner, renderPrompt(), entry.id);
  };

  /** Shows a running job's output as it is now. */
  const draw = (record: Live, view: LiveOutput): void => {
    const entry = entryOf(record.start.id);
    if (entry === undefined) return;
    if (view.clears > record.clears) {
      record.clears = view.clears;
      wipe(entry, view.screen === 'reset' ? 'reset' : 'clear');
    }
    screen.update(entry.id, { blocks: view.blocks });
  };

  /** A finished line that never had an entry: one is added for it now, as it ended. */
  const record = ({ line, blocks, screen: action, prompt: typedAt, status, interrupted, origin, startedAt, endedAt }: ScreenCommit): void => {
    if (action === 'clear') screen.clear();
    if (action === 'reset') {
      screen.clear();
      bannerEntry(screen, banner, renderPrompt());
    }
    const state = interrupted ? 'interrupted' : 'done';
    if (action === 'keep') screen.push({ prompt: typedAt, line, blocks, status, state, origin, startedAt, endedAt });
    // After a clear, the output stays and the prompt line it was typed at does not.
    else if (blocks.length > 0) screen.push({ prompt: null, line, blocks, status, state, origin, startedAt, endedAt });
  };

  return {
    begin(start) {
      const waited = start.continues === undefined ? undefined : entryOf(start.continues);
      if (waited !== undefined) screen.update(waited.id, { job: start.id });
      else {
        screen.push({
          prompt: start.prompt,
          line: start.line,
          blocks: [],
          state: 'running',
          origin: start.origin,
          startedAt: start.startedAt,
          job: start.id,
        });
      }
      live.set(start.id, { start, clears: 0, queued: false });
    },

    changed(id) {
      const running = live.get(id);
      if (running === undefined || running.queued) return;
      running.queued = true;
      frame(() => {
        running.queued = false;
        // Not if the job has ended since: its entry already shows how.
        if (live.get(id) === running) draw(running, running.start.output());
      });
    },

    commit(result) {
      const running = live.get(result.id);
      live.delete(result.id);
      const entry = entryOf(result.id);
      if (entry === undefined) {
        // Begun and since taken off the screen: it stays off. Never begun: it goes on now.
        if (running === undefined) record(result);
        return;
      }
      // A clear or reset the screen has not shown yet happens now, before the output it left.
      if (result.screen !== 'keep') {
        const clears = running?.start.output().clears ?? 1;
        if (clears > (running?.clears ?? 0)) wipe(entry, result.screen);
      }
      const wiped = entryOf(result.id)?.prompt === null;
      if (wiped && result.blocks.length === 0) {
        screen.remove(entry.id);
        return;
      }
      screen.update(entry.id, {
        blocks: result.blocks,
        state: result.interrupted ? 'interrupted' : 'done',
        status: result.status,
        endedAt: result.endedAt,
        job: undefined,
      });
    },
  };
}
