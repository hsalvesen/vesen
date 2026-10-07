// Naming what a browser says about its system, the way fastfetch words it: the GPU without its
// driver details, macOS by name, the Darwin and Windows releases, and a MacBook from its display.
// Pure functions, kept apart from lib/sysfacts.ts, which the shell's kernel reads facts with, so
// they load with fastfetch alone.

/** The GPU's name from a WebGL renderer string, without ANGLE's wrapping and driver details. */
export function gpuName(renderer: string): string {
  let name = renderer.trim();
  const angle = /^ANGLE \([^,]*, (.+?)(?:, [^,]*)?\)$/.exec(name);
  if (angle?.[1] !== undefined) name = angle[1];
  name = name
    .replace(/^ANGLE Metal Renderer: /, '')
    .replace(/\s+(?:Direct3D|OpenGL Engine|vs_\d).*$/, '')
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .trim();
  return name === '' ? renderer : name;
}

const MACOS_NAMES: Readonly<Record<number, string>> = {
  11: 'Big Sur',
  12: 'Monterey',
  13: 'Ventura',
  14: 'Sonoma',
  15: 'Sequoia',
  26: 'Tahoe',
};

/** macOS's name for a major version: `Tahoe` for 26; null for one it does not know. */
export function macosName(major: number): string | null {
  return MACOS_NAMES[major] ?? null;
}

/** The Darwin release under a macOS major version: 25 under macOS 26, 24 under 15, 20 under 11. */
export function darwinRelease(major: number): number | null {
  if (major >= 26) return major - 1;
  if (major >= 11) return major + 9;
  return null;
}

/** Windows' release from the client hints' platform version: 13 and above is 11, 1 to 12 is 10. */
export function windowsRelease(platformVersion: string): string {
  const major = Number.parseInt(platformVersion, 10);
  if (major >= 13) return '11';
  if (major >= 1) return '10';
  return '8.1 or older';
}

/**
 * A MacBook's model from its built-in display's default size, in CSS pixels; null for any other
 * size, such as an external display or a scaled one. A guess, and labelled as one.
 */
export function macModel(width: number, height: number): string | null {
  const sizes: Readonly<Record<string, string>> = {
    '1512x982': 'MacBook Pro (14-inch)',
    '1728x1117': 'MacBook Pro (16-inch)',
    '1470x956': 'MacBook Air (13-inch)',
    '1710x1112': 'MacBook Air (15-inch)',
    '1440x900': 'MacBook Air (13-inch)',
  };
  return sizes[`${width}x${height}`] ?? null;
}
