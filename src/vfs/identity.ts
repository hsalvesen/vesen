// Who the visitor is, in one place (docs/plan/02-architecture-and-contracts.md, section 15): the
// prompt, /etc/passwd and /etc/group, $HOME and $USER, the file owners in the VFS and fastfetch
// all read it, so they can never disagree again (F024).

import type { User } from '../shell/types';

/** The prompt's host: the brand, the same on every domain. */
export const HOST = 'vesen';

/** The visitor's login shell. */
export const LOGIN_SHELL = '/bin/vesh';

/** The shell's process id, `$$`: the same every session, as the process table, ps and /proc give it. */
export const SHELL_PID = 4242;

/** The terminal the visitor types in, /dev/pts/0: tty, ps, who and /dev all name it. */
export const TERMINAL = 'pts/0';

/** The visitor. */
export const GUEST: User = {
  name: 'guest',
  uid: 1000,
  gid: 1000,
  groups: [1000],
  home: '/home/guest',
  shell: LOGIN_SHELL,
};

/** Where the visitor's home used to be; kept as a symbolic link to it, so old examples work. */
export const LEGACY_HOME = '/home/user';

/** The owner, whose read-only portfolio files are in /home/has. */
export const OWNER = {
  name: 'has',
  uid: 1001,
  gid: 1001,
  home: '/home/has',
  fullName: 'Has Salvesen',
} as const;

/** Where to find the owner: the portfolio commands' cards and /home/has/about.md. */
export const OWNER_LINKS = {
  linkedin: 'https://www.linkedin.com/in/harrysalvesen/',
  github: 'https://github.com/hsalvesen',
  email: 'has@salvesen.app',
  repo: 'https://github.com/hsalvesen/vesen',
  site: 'https://www.vesen.app/',
} as const;

/** One line of /etc/passwd. */
export interface Account {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly gecos: string;
  readonly home: string;
  readonly shell: string;
}

/** Every account, in /etc/passwd order. */
export const ACCOUNTS: readonly Account[] = [
  { name: 'root', uid: 0, gid: 0, gecos: 'root', home: '/root', shell: LOGIN_SHELL },
  { name: 'nobody', uid: 65534, gid: 65534, gecos: 'nobody', home: '/nonexistent', shell: '/usr/sbin/nologin' },
  { name: GUEST.name, uid: GUEST.uid, gid: GUEST.gid, gecos: 'Guest', home: GUEST.home, shell: LOGIN_SHELL },
  { name: OWNER.name, uid: OWNER.uid, gid: OWNER.gid, gecos: OWNER.fullName, home: OWNER.home, shell: LOGIN_SHELL },
];

/** One line of /etc/group. */
export interface Group {
  readonly name: string;
  readonly gid: number;
  readonly members: readonly string[];
}

export const GROUPS: readonly Group[] = [
  { name: 'root', gid: 0, members: [] },
  { name: 'adm', gid: 4, members: [] },
  { name: 'tty', gid: 5, members: [] },
  { name: 'shadow', gid: 42, members: [] },
  { name: 'nogroup', gid: 65534, members: [] },
  { name: GUEST.name, gid: GUEST.gid, members: [] },
  { name: OWNER.name, gid: OWNER.gid, members: [] },
];

/** The uid of a user name; unknown names belong to nobody. */
export function uidOf(name: string): number {
  return ACCOUNTS.find((account) => account.name === name)?.uid ?? 65534;
}

/** The gid of a group name; unknown names belong to nogroup. */
export function gidOf(name: string): number {
  return GROUPS.find((group) => group.name === name)?.gid ?? 65534;
}

/** The home folder of a user name, for `~has`; undefined for anyone else. */
export function homeOf(name: string): string | undefined {
  return ACCOUNTS.find((account) => account.name === name)?.home;
}

/** The prompt's path: the home folder as `~`, and anything under it as `~/...`. */
export function tildePath(path: string, home: string = GUEST.home): string {
  if (path === home) return '~';
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}
