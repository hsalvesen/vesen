// The role colours (docs/plan/02-architecture-and-contracts.md, section 10). The palette says
// what a colour is; a role says what text is for: errors, hints, the prompt, links, weather.
// A theme may set any role in themes.json, as a hex colour or the name of one of its palette
// slots; every role it leaves out is computed from the palette and nudged lighter or darker,
// keeping its hue, until it reads clearly. platform/theme-apply.ts writes them as --role-*, and
// scripts/check-contrast.mjs imports this file to check exactly what the app applies.
//
// Imported by Node directly, so it imports with file extensions and only erasable syntax.
import type { Palette, Role } from '../output/model.ts';
import { contrastRatio, ensureContrast, isHexColour, mix, parseHex, relativeLuminance, toHex } from './colour.ts';

/** A palette slot, as themes.json names it. */
export type PaletteSlot = Palette | 'cursorColor';

/** What this module reads from a theme: its palette and its optional role overrides. */
export type ThemeColours = { readonly name: string; readonly roles?: Readonly<Partial<Record<Role, string>>> } & Readonly<
  Record<PaletteSlot, string>
>;

export type RoleColours = Readonly<Record<Role, string>>;

/** WCAG AA for normal-size text. */
export const TEXT_MIN = 4.5;
/** WCAG AA for large text and for the parts of a control, such as the cursor. */
export const NON_TEXT_MIN = 3;
/** QR codes need a wider margin than text to scan reliably. */
export const QR_MIN = 7;
/** How strongly a panel is tinted with its tone, as in styles/components.css. */
export const PANEL_TINT = 0.12;
/** The tones a panel may take: a 4px border and a 12% tint, with the title in the tone. */
export const PANEL_TONES = ['accent', 'warn', 'ok', 'error', 'link', 'muted'] as const satisfies readonly Role[];

/**
 * Roles that colour text, and the palette slot each is computed from. Each must reach 4.5:1
 * against the background and against a panel tinted with itself, where it titles the panel.
 */
export const TEXT_ROLE_SOURCES = {
  fg: 'foreground',
  'fg-strong': 'white',
  muted: 'brightBlack',
  accent: 'cyan',
  ok: 'green',
  warn: 'yellow',
  error: 'red',
  link: 'brightBlue',
  'prompt-user': 'yellow',
  'prompt-host': 'green',
  'prompt-path': 'blue',
  sun: 'yellow',
  rain: 'blue',
  cold: 'cyan',
  hot: 'red',
} as const satisfies Partial<Record<Role, PaletteSlot>>;

export type TextRole = keyof typeof TEXT_ROLE_SOURCES;
export const TEXT_ROLES = Object.keys(TEXT_ROLE_SOURCES) as TextRole[];

/** Every role, in the order of output/model.ts's ROLES (roles.test.ts keeps the two in step). */
export const ROLE_NAMES = [
  'fg', 'fg-strong', 'muted', 'accent', 'ok', 'warn', 'error', 'link',
  'chip-bg', 'chip-fg', 'ghost', 'selection', 'cursor',
  'prompt-user', 'prompt-host', 'prompt-path',
  'sun', 'rain', 'cold', 'hot', 'qr-ink', 'qr-paper',
] as const satisfies readonly Role[];

/** A theme's own value for a role, as a hex colour; `nudge` when it named a palette slot. */
function override(theme: ThemeColours, role: Role): { colour: string; nudge: boolean } | undefined {
  const value = theme.roles?.[role];
  if (value === undefined) return undefined;
  if (isHexColour(value)) return { colour: toHex(parseHex(value) ?? [0, 0, 0]), nudge: false };
  const slot = theme[value as PaletteSlot] as unknown;
  return isHexColour(slot) ? { colour: toHex(parseHex(slot) ?? [0, 0, 0]), nudge: true } : undefined;
}

/** The palette slot's colour, as `#rrggbb`; the foreground when the slot is missing or broken. */
function slot(theme: ThemeColours, name: PaletteSlot): string {
  const value = theme[name] as unknown;
  if (isHexColour(value)) return toHex(parseHex(value) ?? [0, 0, 0]);
  return isHexColour(theme.foreground) ? toHex(parseHex(theme.foreground) ?? [0, 0, 0]) : '#808080';
}

export type PanelTone = (typeof PANEL_TONES)[number];

export function isPanelTone(role: string): role is PanelTone {
  return (PANEL_TONES as readonly string[]).includes(role);
}

/** The contrast of text in `colour`, at its worst: on the background, or on a panel it tints. */
export function textContrast(colour: string, background: string): number {
  return Math.min(contrastRatio(colour, background), contrastRatio(colour, mix(background, colour, PANEL_TINT)));
}

/**
 * Ink and paper for an inline QR code: the darkest of the dark slots on the lightest of the light
 * ones, so a code reads dark on light in every theme, or black on white when they are too close.
 */
function qrColours(theme: ThemeColours): { ink: string; paper: string } {
  const lightestFirst = (names: PaletteSlot[]) =>
    names.map((name) => slot(theme, name)).sort((a, b) => (relativeLuminance(b) ?? 0) - (relativeLuminance(a) ?? 0));
  const darks = lightestFirst(['background', 'black', 'foreground']);
  const ink = darks[darks.length - 1] ?? '#000000';
  const paper = lightestFirst(['brightWhite', 'white', 'foreground', 'background'])[0] ?? '#ffffff';
  return contrastRatio(ink, paper) >= QR_MIN ? { ink, paper } : { ink: '#000000', paper: '#ffffff' };
}

/** Every role colour for a theme, as the app applies them. */
export function deriveRoles(theme: ThemeColours): RoleColours {
  const background = slot(theme, 'background');
  const roles: Partial<Record<Role, string>> = {};

  /** The theme's own colour as it is, or `computed` nudged until `measure` reaches `min`. */
  const resolve = (role: Role, computed: string, min: number, measure: (c: string) => number): string => {
    const own = override(theme, role);
    if (own && !own.nudge) return own.colour;
    return ensureContrast(own?.colour ?? computed, background, min, measure);
  };

  // Panel tones first, which title panels tinted with themselves; body text is checked against
  // their tints below.
  const onBackground = (c: string) => contrastRatio(c, background);
  for (const role of TEXT_ROLES) {
    if (role === 'fg' || role === 'fg-strong') continue;
    const measure = isPanelTone(role) ? (c: string) => textContrast(c, background) : onBackground;
    roles[role] = resolve(role, slot(theme, TEXT_ROLE_SOURCES[role]), TEXT_MIN, measure);
  }
  const tints = PANEL_TONES.map((tone) => mix(background, roles[tone] ?? background, PANEL_TINT));
  const bodyContrast = (c: string) => Math.min(textContrast(c, background), ...tints.map((tint) => contrastRatio(c, tint)));
  roles.fg = resolve('fg', slot(theme, 'foreground'), TEXT_MIN, bodyContrast);
  roles['fg-strong'] = resolve('fg-strong', slot(theme, 'white'), TEXT_MIN, bodyContrast);

  roles.ghost = resolve('ghost', slot(theme, 'brightBlack'), NON_TEXT_MIN, onBackground);
  roles.cursor = resolve('cursor', slot(theme, 'cursorColor'), NON_TEXT_MIN, onBackground);

  const accent = roles.accent ?? background;
  roles['chip-bg'] = override(theme, 'chip-bg')?.colour ?? mix(background, accent, 0.15);
  const chipBg = roles['chip-bg'];
  roles['chip-fg'] = override(theme, 'chip-fg')?.colour ?? ensureContrast(roles.fg, chipBg, TEXT_MIN);

  // Selected text keeps its own colour, so the highlight eases off until both body colours read on it.
  const fg = roles.fg;
  const strong = roles['fg-strong'];
  const readsOn = (selection: string) => Math.min(contrastRatio(fg, selection), contrastRatio(strong, selection)) >= TEXT_MIN;
  let selection = override(theme, 'selection')?.colour;
  for (let amount = 0.35; selection === undefined; amount -= 0.05) {
    const candidate = mix(background, accent, Math.max(0, amount));
    if (amount <= 0 || readsOn(candidate)) selection = candidate;
  }
  roles.selection = selection;

  const qr = qrColours(theme);
  roles['qr-ink'] = override(theme, 'qr-ink')?.colour ?? qr.ink;
  roles['qr-paper'] = override(theme, 'qr-paper')?.colour ?? qr.paper;

  return Object.fromEntries(ROLE_NAMES.map((role) => [role, roles[role] ?? background])) as Record<Role, string>;
}

/** One contrast requirement on an applied role. */
export interface RoleCheck {
  readonly role: Role;
  /** What it is measured against, for the report: `background`, `tint:<tone>`, `chip-bg`, ... */
  readonly against: string;
  readonly ratio: number;
  readonly min: number;
}

/**
 * Every contrast requirement the roles must meet, measured on the applied colours: text roles
 * on the background and on their own panel tint, body text on every panel tint and on the
 * selection, the ghost text and the cursor at 3:1, chip text on the chip, and QR ink on paper.
 */
export function roleChecks(theme: ThemeColours, roles: RoleColours = deriveRoles(theme)): RoleCheck[] {
  const background = slot(theme, 'background');
  const checks: RoleCheck[] = [];
  const add = (role: Role, against: string, backdrop: string, min: number) =>
    checks.push({ role, against, ratio: contrastRatio(roles[role], backdrop), min });

  for (const role of TEXT_ROLES) {
    add(role, 'background', background, TEXT_MIN);
    if (isPanelTone(role)) add(role, `tint:${role}`, mix(background, roles[role], PANEL_TINT), TEXT_MIN);
  }
  for (const role of ['fg', 'fg-strong'] as const) {
    for (const tone of PANEL_TONES) add(role, `tint:${tone}`, mix(background, roles[tone], PANEL_TINT), TEXT_MIN);
    add(role, 'selection', roles.selection, TEXT_MIN);
  }
  add('ghost', 'background', background, NON_TEXT_MIN);
  add('cursor', 'background', background, NON_TEXT_MIN);
  add('chip-fg', 'chip-bg', roles['chip-bg'], TEXT_MIN);
  add('qr-ink', 'qr-paper', roles['qr-paper'], QR_MIN);
  return checks;
}
