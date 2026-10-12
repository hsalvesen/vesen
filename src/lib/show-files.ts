// The files of sudo's show, served from this origin: the owner's track and their frames (the
// format is in lib/frames.ts). DOM-free and tiny, so the boot (app/bootstrap.ts, through
// services/warm-show.ts) can warm them at idle without pulling in the show itself
// (commands/lib/rick.ts), which reads them from here.

/** The track: public/audio/incident-report.mp3. */
export const SHOW_TRACK = '/audio/incident-report.mp3';

/** The frames: public/audio/incident-report.frames. */
export const SHOW_FRAMES = '/audio/incident-report.frames';
