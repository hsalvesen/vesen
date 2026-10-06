// Legacy output marks the current theme, CRT mode and fastfetch theme name with classes, and
// these patch every earlier listing when either changes. Interim: ported commands use
// LiveBinding spans (SpanView), and this goes when theme, cathode and fastfetch are ported.

export function markCurrentTheme(root: ParentNode, name: string): void {
  const current = name.toLowerCase();
  for (const el of root.querySelectorAll<HTMLElement>('.theme-name')) {
    el.classList.toggle('is-current', el.getAttribute('data-theme-name')?.toLowerCase() === current);
  }
  for (const el of root.querySelectorAll<HTMLElement>('.current-theme-name')) el.textContent = name;
}

export function markCurrentCathode(root: ParentNode, mode: string): void {
  for (const el of root.querySelectorAll<HTMLElement>('.cathode-name')) {
    el.classList.toggle('is-current', el.getAttribute('data-cathode-name') === mode);
  }
}
