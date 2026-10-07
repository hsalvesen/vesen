// The file tree a new session starts with (docs/plan/08-shell-and-commands.md, "The file system
// after this plan"): the legacy tree from src/utils/virtualFileSystem.ts, re-homed so the
// visitor's files live in /home/guest (F003), plus the system folders a Linux visitor expects.
//
//   /bin -> usr/bin           /home/guest (HOME)     /proc (generated on read)
//   /boot/vmlinuz-6.6.0-vesen /home/has (read-only)  /root (700)
//   /dev null zero random urandom tty                 /tmp (1777)
//   /etc hostname hosts os-release passwd group shadow shells motd profile timezone
//   /home/user -> guest       /usr/bin, /usr/local/bin, /usr/share/man/man1 (from the registry)
//   /var/log/syslog
//
// The owner's styled documents come from src/content in {colour} markup: the VFS keeps their
// plain text, so grep and wc read prose, and their styled lines for cat on a terminal (F093).

import historyMarkup from '../content/history.vt?raw';
import linuxMarkup from '../content/linux.vt?raw';
import readmeMarkup from '../content/README.vt?raw';
import { parseMarkup } from '../output/markup';
import { ACCOUNTS, GROUPS, GUEST, HOST, LEGACY_HOME, LOGIN_SHELL, OWNER, OWNER_LINKS } from './identity';
import { binStubs, devTree, KERNEL_RELEASE, manPages, procTree, type CommandInfo } from './special';
import type { VirtualFile } from './types';

/** When the seed files were last changed, as their mtime: fixed, so the overlay can compare them. */
export const SEED_MTIME = Date.UTC(2026, 9, 6, 0, 0, 0);

export interface SeedOptions {
  /** The app's version, for /etc/os-release and /proc/version. */
  readonly version: string;
  /** The registered commands, for the /usr/bin stubs and the man pages. */
  readonly commands: readonly CommandInfo[];
  /** The visitor's time zone, for /etc/timezone. */
  readonly timeZone?: string;
}

type Meta = Pick<VirtualFile, 'mode' | 'owner' | 'group'>;

function file(name: string, content: string, meta: Meta = {}): VirtualFile {
  return { name, type: 'file', content, ...meta };
}

function styledFile(name: string, markup: string, meta: Meta = {}): VirtualFile {
  const { text, lines } = parseMarkup(markup);
  return { name, type: 'file', content: text, styled: lines, ...meta };
}

function dir(name: string, children: readonly VirtualFile[], meta: Meta = {}): VirtualFile {
  return { name, type: 'directory', children: Object.fromEntries(children.map((child) => [child.name, child])), ...meta };
}

function link(name: string, target: string, meta: Meta = {}): VirtualFile {
  return { name, type: 'symlink', target, mode: 0o777, ...meta };
}

/** Gives a subtree to a user: every node in it, unless a node names its own owner. */
function ownedBy(node: VirtualFile, owner: string, group = owner): VirtualFile {
  node.owner ??= owner;
  node.group ??= group;
  for (const child of Object.values(node.children ?? {})) ownedBy(child, owner, group);
  return node;
}

// ── The visitor's home ─────────────────────────────────────────────────────────────────────

const BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells

# User specific aliases and functions
alias ll="ls -la"
alias la="ls -A"
alias l="ls -CF"

# Add ~/bin to PATH
export PATH="$HOME/bin:$PATH"

# Custom prompt
export PS1="\\u@\\h:\\w$ "`;

// No if: vesen's shell has none, and `source ~/.profile` must work.
const PROFILE = `# ~/.profile: executed by the command interpreter for login shells

# Set PATH to include user's private bin if it exists
[ -d "$HOME/bin" ] && PATH="$HOME/bin:$PATH"

# Set default editor
export EDITOR=vim`;

/** The visitor's home folder: the legacy /home/user tree, in its original order. */
function guestHome(): VirtualFile {
  const home = dir(
    GUEST.name,
    [
      styledFile('README.md', readmeMarkup),
      styledFile('history.txt', historyMarkup),
      dir('documents', [styledFile('linux.txt', linuxMarkup)]),
      dir('projects', [
        dir('vesen', [
          file('info.txt', 'Vesen Terminal\n\nA web-based terminal built with Svelte and TypeScript.\n\nRepository: https://github.com/hsalvesen/vesen'),
        ]),
        dir('portfolio', [
          file('index.html', '<!DOCTYPE html>\n<html>\n<head><title>Portfolio</title></head>\n<body><h1>My Portfolio</h1></body>\n</html>'),
        ]),
        dir('learning', [
          file(
            'javascript-basics.js',
            '// JavaScript learning examples\nconsole.log("Hello, World!");\n\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}',
          ),
        ]),
      ]),
      dir('desktop', [file('shortcuts.txt', 'Desktop shortcuts and quick access files')]),
      dir('downloads', [file('software.tar.gz', 'Compressed archive file'), file('README-download.txt', 'Downloaded files and packages')]),
      dir('pictures', [file('vacation.jpg', 'JPEG image file')]),
      dir('music', [file('playlist.m3u', '#EXTM3U\n#EXTINF:180,Song Title\nsong.mp3')]),
      dir('videos', [file('tutorial.mp4', 'MP4 video file')]),
      dir('public', [file('shared-file.txt', 'This file is shared with other users')]),
      dir('templates', [file('document-template.txt', 'Template for creating new documents')]),
      dir('bin', [
        file('my-script', `#!${LOGIN_SHELL}\necho "Personal script executed"`, { mode: 0o755 }),
        file('deploy', `#!${LOGIN_SHELL}\necho "Deploying application..."`, { mode: 0o755 }),
      ]),
      dir('src', [file('main.c', '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}')]),
      dir('scripts', [
        file(
          'backup.sh',
          `#!${LOGIN_SHELL}\n# Backup script\necho "Creating backup..."\ntar -czf backup-$(date +%Y%m%d).tar.gz ~/documents`,
          { mode: 0o755 },
        ),
        file('setup.py', '#!/usr/bin/env python3\n# Setup script\nprint("Setting up environment...")', { mode: 0o755 }),
      ]),
      dir('config', [file('app.conf', '# Application configuration\ntheme=dark\nlanguage=en\ndebug=false')]),
      file('.bashrc', BASHRC),
      file('.profile', PROFILE),
      file(
        '.vimrc',
        '" ~/.vimrc: Vim configuration\n\nset number\nset tabstop=4\nset shiftwidth=4\nset expandtab\nset autoindent\nset hlsearch\nset incsearch\n\nsyntax on\ncolorscheme default',
      ),
      file(
        '.gitconfig',
        '[user]\n\tname = User\n\temail = user@example.com\n\n[core]\n\teditor = vim\n\n[alias]\n\tst = status\n\tco = checkout\n\tbr = branch\n\tci = commit',
      ),
      dir(
        '.ssh',
        [
          file('config', '# SSH client configuration\n\nHost github.com\n    HostName github.com\n    User git\n    IdentityFile ~/.ssh/id_rsa', {
            mode: 0o600,
          }),
          file(
            'known_hosts',
            '# SSH known hosts\ngithub.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDjI+e\ntest-server.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG4rT3vTt\ndev.localhost ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDGhlOTsIXO\nmyserver.net ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCvuydfeYbH',
            { mode: 0o644 },
          ),
        ],
        { mode: 0o700 },
      ),
      dir('.local', [dir('share', [dir('applications', [])])]),
      file('.bash_history', '', { mode: 0o600 }),
    ],
    { mode: 0o755 },
  );
  return ownedBy(home, GUEST.name);
}

// ── The owner's home ───────────────────────────────────────────────────────────────────────
//
// Written only from what the repository already says about its author and this project. The
// owner should edit these three files to say what he wants visitors to read.

const ABOUT = `# ${OWNER.fullName}

I built vesen, the terminal you are typing in.

- LinkedIn: ${OWNER_LINKS.linkedin}
- GitHub:   ${OWNER_LINKS.github}
- Email:    mailto:${OWNER_LINKS.email}
- Website:  https://www.vesen.app

Try \`whoami\`, \`email\` or \`repo\` to reach me from here.
`;

const PROJECTS = `# Projects

## vesen
A Unix-like terminal in the browser: a shell with pipes, redirection and history, a virtual
file system, themes and a CRT effect.

- Live:   https://www.vesen.app
- Source: https://github.com/hsalvesen/vesen
- Stack:  Svelte 5, TypeScript, Vite, Tailwind CSS, Firebase Hosting
`;

const PLAN = `Working on vesen: https://www.vesen.app
Source: https://github.com/hsalvesen/vesen
`;

function ownerHome(): VirtualFile {
  const readOnly: Meta = { mode: 0o644 };
  return ownedBy(
    dir('has', [file('about.md', ABOUT, readOnly), file('projects.md', PROJECTS, readOnly), file('.plan', PLAN, readOnly)], { mode: 0o755 }),
    OWNER.name,
  );
}

// ── /etc ───────────────────────────────────────────────────────────────────────────────────

function etc(options: SeedOptions): VirtualFile {
  const passwd = ACCOUNTS.map((a) => `${a.name}:x:${a.uid}:${a.gid}:${a.gecos}:${a.home}:${a.shell}`).join('\n');
  const group = GROUPS.map((g) => `${g.name}:x:${g.gid}:${g.members.join(',')}`).join('\n');
  const shadow = ACCOUNTS.map((a) => `${a.name}:${a.name === 'root' || a.name === 'nobody' ? '*' : '!'}:20367:0:99999:7:::`).join('\n');
  const osRelease = [
    'NAME="Vesen Linux"',
    `VERSION="${options.version}"`,
    'ID=vesen',
    'ID_LIKE=debian',
    `VERSION_ID="${options.version}"`,
    `PRETTY_NAME="Vesen Linux ${options.version}"`,
    'HOME_URL="https://www.vesen.app"',
    'BUG_REPORT_URL="https://github.com/hsalvesen/vesen/issues"',
  ].join('\n');
  const motd = [
    `Welcome to Vesen Linux ${options.version} (${KERNEL_RELEASE})`,
    '',
    "Type 'help' to see all available commands.",
  ].join('\n');
  const profile = [
    '# /etc/profile: system-wide settings for login shells',
    '',
    'export EDITOR=nano',
    'export PAGER=less',
  ].join('\n');
  return dir('etc', [
    file('hostname', `${HOST}\n`),
    file('hosts', `127.0.0.1\tlocalhost\n127.0.1.1\t${HOST}\n::1\t\tlocalhost ip6-localhost ip6-loopback\n`),
    file('os-release', `${osRelease}\n`),
    file('passwd', `${passwd}\n`),
    file('group', `${group}\n`),
    file('shadow', `${shadow}\n`, { mode: 0o640, owner: 'root', group: 'shadow' }),
    file('shells', `# /etc/shells: valid login shells\n${LOGIN_SHELL}\n/bin/sh\n`),
    file('motd', `${motd}\n`),
    file('profile', `${profile}\n`),
    file('timezone', `${options.timeZone ?? 'Etc/UTC'}\n`),
  ]);
}

// ── The whole tree ─────────────────────────────────────────────────────────────────────────

/** Dates every node that has no mtime of its own. */
function stamp(node: VirtualFile, mtime: number): VirtualFile {
  node.mtime ??= mtime;
  for (const child of Object.values(node.children ?? {})) stamp(child, mtime);
  return node;
}

/** A fresh seed tree. Every call builds new nodes, so `reset` can start again from it. */
export function seedTree(options: SeedOptions): VirtualFile {
  return stamp(buildTree(options), SEED_MTIME);
}

function buildTree(options: SeedOptions): VirtualFile {
  const commands = [...options.commands].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const syslog = [
    `${HOST} kernel: [    0.000000] Linux version ${KERNEL_RELEASE}`,
    `${HOST} systemd[1]: Started System Logging Service.`,
    `${HOST} systemd[1]: Reached target Multi-User System.`,
  ].join('\n');
  return dir(
    '',
    [
      link('bin', 'usr/bin'),
      dir('usr', [
        dir('bin', binStubs(commands)),
        dir('local', [dir('bin', [])]),
        dir('share', [dir('man', [dir('man1', manPages(commands))])]),
      ]),
      dir('var', [dir('log', [file('syslog', `${syslog}\n`, { mode: 0o644, owner: 'root', group: 'adm' })])]),
      dir('tmp', [], { mode: 0o1777 }),
      dir('opt', []),
      dir('lib', []),
      dir('boot', [file(`vmlinuz-${KERNEL_RELEASE}`, 'Linux kernel x86 boot executable bzImage\n', { mode: 0o600 })]),
      devTree(),
      procTree(options.version),
      dir('sys', [], { mode: 0o555 }),
      dir('mnt', []),
      dir('media', []),
      dir('root', [], { mode: 0o700 }),
      dir('home', [guestHome(), ownerHome(), link(LEGACY_HOME.slice('/home/'.length), GUEST.name)]),
      etc(options),
    ],
    { mode: 0o755, owner: 'root', group: 'root' },
  );
}

/** A short fingerprint of the visitor's seed home, so a changed seed is noticed on reload. */
export function seedVersion(tree: VirtualFile, under: string = GUEST.home): string {
  let node: VirtualFile | undefined = tree;
  for (const part of under.split('/').filter(Boolean)) node = node?.children?.[part];
  // FNV-1a over the home folder's names, types, modes and contents.
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  const visit = (at: string, current: VirtualFile): void => {
    feed(`${at}\0${current.type}\0${current.mode ?? ''}\0${current.content ?? current.target ?? ''}\0`);
    for (const name of Object.keys(current.children ?? {}).sort()) {
      const child = current.children?.[name];
      if (child !== undefined) visit(`${at}/${name}`, child);
    }
  };
  if (node !== undefined) visit(under, node);
  return hash.toString(16).padStart(8, '0');
}
