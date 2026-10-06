// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import themes from '../../themes.json';
import { deriveRoles } from '../lib/roles';
import { ROLES } from '../output/model';
import { applyRoles, rolesFor } from './theme-apply';

afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('applyRoles', () => {
  it('writes every role as --role-*, exactly as lib/roles derives it, for every theme', () => {
    const root = document.documentElement;
    for (const theme of themes) {
      applyRoles(root, theme);
      const expected = deriveRoles(theme);
      for (const role of ROLES) {
        expect(root.style.getPropertyValue(`--role-${role}`), `${theme.name} ${role}`).toBe(expected[role]);
      }
    }
  });

  it('works the roles out once per theme', () => {
    const [first] = themes;
    if (!first) throw new Error('no themes');
    expect(rolesFor(first)).toBe(rolesFor(first));
  });
});
