// What poweroff, reboot and shutdown hand the Shutdown app (src/ui/apps/Shutdown.svelte) through
// ctx.tty.fullscreen, and what it hands back. Its own module, so the app's chunk does not pull in
// the kernel's app runner.

/** The Shutdown app's view model. */
export interface ShutdownView {
  readonly kind: 'poweroff' | 'reboot';
  /** systemd's lines, `[  OK  ] Stopped …`, shown one after another. */
  readonly lines: readonly string[];
  /** In an in-app browser, the off screen says how to close the page. */
  readonly inApp: boolean;
  /** A touch screen: Power on is a tap; on a desktop any key works too. */
  readonly touch: boolean;
}

/** The Shutdown app's result: the visitor powered on (or the reboot finished). */
export const POWER_ON = 'power-on';
