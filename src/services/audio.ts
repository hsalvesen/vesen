// The page's one AudioContext, shared by everything that makes a sound (the bell in bell.ts, the
// chiptune in chiptune.ts). Browsers cap how many contexts a page may create, and each one holds
// an audio thread until it is closed, so there is exactly one, made the first time a sound is
// asked for. A context created before any user gesture starts suspended; whoever plays resumes it
// inside a gesture, as the browser's autoplay rules require.

type AudioContextConstructor = new () => AudioContext;

let context: AudioContext | null = null;

/** The shared AudioContext, or null where the browser has no Web Audio. */
export function audioContext(): AudioContext | null {
  if (context) return context;
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor };
  const Context: AudioContextConstructor | undefined = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) return null;
  try {
    context = new Context();
  } catch {
    return null;
  }
  return context;
}
