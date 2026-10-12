// The files of sudo's show, served from this origin: the owner's track and their frames (the
// format is in lib/frames.ts), in two cuts: the whole picture, and the middle of it for a screen
// taller than wide. DOM-free and tiny, so the boot (app/bootstrap.ts, through
// services/warm-show.ts) can warm them at idle without pulling in the show itself
// (commands/lib/rick.ts), which reads them from here.

/** The track: public/audio/incident-report.mp3. */
export const SHOW_TRACK = '/audio/incident-report.mp3';

/** The frames: public/audio/incident-report.frames, the whole picture, 120 columns by 45 rows. */
export const SHOW_FRAMES = '/audio/incident-report.frames';

/**
 * The portrait cut: public/audio/incident-report.portrait.frames, the middle of the picture
 * (cropped at the sides about its centre), 72 columns by 56 rows, frame for frame with the whole
 * one, for a screen taller than wide, which it fills.
 */
export const SHOW_FRAMES_PORTRAIT = '/audio/incident-report.portrait.frames';

/** What a screen taller than wide answers: there the portrait cut plays. */
export const PORTRAIT_QUERY = '(orientation: portrait)';

/** The frames for a screen: the portrait cut where it is taller than wide, the whole picture otherwise. */
export function showFramesFor(portrait: boolean): string {
  return portrait ? SHOW_FRAMES_PORTRAIT : SHOW_FRAMES;
}
