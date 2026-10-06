// Legacy fastfetch prints the theme's name as its WM Theme, marked with a class, and this keeps
// every earlier fastfetch true when the theme changes. Interim: theme and cathode are specs with
// LiveBinding spans now (SpanView), and this goes when fastfetch is ported with the
// currentThemeName binding.

export function markCurrentThemeName(root: ParentNode, name: string): void {
  for (const el of root.querySelectorAll<HTMLElement>('.current-theme-name')) el.textContent = name;
}
