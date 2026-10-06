// Writes a theme's role colours (src/lib/roles.ts) onto the page as --role-* variables, beside
// the palette's --theme-* variables that platform/head.ts writes. Output names roles and palette
// slots, never hex values, so everything on screen follows the theme when it changes. Working the
// roles out here costs less to download than shipping every theme's finished colours.
import { deriveRoles, type RoleColours, type ThemeColours } from '../lib/roles';
import { ROLES } from '../output/model';

const derived = new WeakMap<ThemeColours, RoleColours>();

/** The theme's roles, worked out once per theme object. */
export function rolesFor(theme: ThemeColours): RoleColours {
  let roles = derived.get(theme);
  if (roles === undefined) {
    roles = deriveRoles(theme);
    derived.set(theme, roles);
  }
  return roles;
}

export function applyRoles(root: HTMLElement, theme: ThemeColours): void {
  const roles = rolesFor(theme);
  for (const role of ROLES) root.style.setProperty(`--role-${role}`, roles[role]);
}
