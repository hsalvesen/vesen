// The name of the site the terminal is served from (www.vesen.app), which only the page knows:
// the composition root (app/bootstrap.ts) hands it in once, and `hostname -f` and `hostname -d`
// read it. DOM-free; with none handed in, as in tests, the prompt's host stands in.

const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

let provided: string | null = null;

/** Sets the site's host name, such as `www.vesen.app`; anything that is not a host name clears it. */
export function provideDomain(name: string | null | undefined): void {
  provided = typeof name === 'string' && HOST_NAME.test(name) ? name.toLowerCase() : null;
}

/** The site's host name, or null when none was handed in. */
export function siteDomain(): string | null {
  return provided;
}
