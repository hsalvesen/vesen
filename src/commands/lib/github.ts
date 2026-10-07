// vesen's own commits, for git log and git show in ~/projects/vesen: the ten newest, from
// GitHub's REST API (GET /repos/hsalvesen/vesen/commits?per_page=10), which allows 60
// requests an hour from one address without signing in. So they are kept for 10 minutes: in the
// tab's session storage (vesen:github:v1) where the app gives one, and in the page's memory.

import { whenAborted } from '../../lib/signals';
import { upstreamText } from '../../lib/upstream-text';
import { replaceUnsafe } from '../../lib/unsafe-text';
import { STORAGE_KEYS } from '../../services/storage-keys';
import type { Clock, Net } from '../../services/types';
import { OWNER_LINKS } from '../../vfs/identity';
import { sessionStore } from './session-store';

export const REPO = 'hsalvesen/vesen';
export const COMMITS_URL = `https://api.github.com/repos/${REPO}/commits?per_page=10`;
export const REMOTE_URL = `${OWNER_LINKS.repo}.git`;
/** The whole history, on GitHub. */
export const OWNER_REPO_COMMITS = `${OWNER_LINKS.repo}/commits`;
/** How long the commits are kept before GitHub is asked again. */
export const KEEP_MS = 10 * 60_000;
/** How many commits one request gives. */
export const PAGE = 10;

export interface Commit {
  readonly sha: string;
  /** The author's name; their e-mail address is not kept or shown. */
  readonly author: string;
  /** When it was authored, in ms. */
  readonly date: number;
  /** The message, line by line as written, made safe to show. */
  readonly message: string;
  readonly parents: readonly string[];
}

const SHA = /^[0-9a-f]{40}$/;
const MAX_MESSAGE = 4000;

function commitOf(raw: unknown): Commit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as { sha?: unknown; commit?: { author?: { name?: unknown; date?: unknown }; message?: unknown }; parents?: unknown };
  const sha = typeof item.sha === 'string' && SHA.test(item.sha) ? item.sha : null;
  const date = typeof item.commit?.author?.date === 'string' ? Date.parse(item.commit.author.date) : Number.NaN;
  const message = typeof item.commit?.message === 'string' ? item.commit.message : null;
  if (sha === null || Number.isNaN(date) || message === null) return null;
  const parents = Array.isArray(item.parents)
    ? item.parents.flatMap((parent: unknown) => {
        const value = (parent as { sha?: unknown } | null)?.sha;
        return typeof value === 'string' && SHA.test(value) ? [value] : [];
      })
    : [];
  return {
    sha,
    author: upstreamText(item.commit?.author?.name, 80) ?? 'unknown',
    date,
    message: message
      .slice(0, MAX_MESSAGE)
      .split(/\r?\n/)
      .map((line) => replaceUnsafe(line.replace(/\t/g, '    ')))
      .join('\n'),
    parents,
  };
}

/** The commits in an answer from the commits API; throws when it is not a list of them. */
export function parseCommits(raw: unknown): Commit[] {
  if (!Array.isArray(raw)) throw new TypeError('not a list of commits');
  const commits = raw.map(commitOf).filter((commit): commit is Commit => commit !== null);
  if (raw.length > 0 && commits.length === 0) throw new TypeError('no commits could be read');
  return commits.slice(0, PAGE);
}

/** Why GitHub gave no commits. */
export class GitHubFailure extends Error {
  constructor(
    readonly kind: 'rate-limit' | 'http' | 'parse',
    message: string,
    /** For rate-limit: when GitHub will answer again, in ms; null when it did not say. */
    readonly resetAt: number | null = null,
  ) {
    super(message);
    this.name = 'GitHubFailure';
  }
}

interface Stored {
  readonly v: 1;
  readonly at: number;
  readonly commits: Commit[];
}

function readStored(raw: unknown): Stored | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as { v?: unknown; at?: unknown; commits?: unknown };
  if (value.v !== 1 || typeof value.at !== 'number' || !Array.isArray(value.commits)) return undefined;
  const commits = value.commits.filter(
    (c: unknown): c is Commit =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as Commit).sha === 'string' &&
      SHA.test((c as Commit).sha) &&
      typeof (c as Commit).author === 'string' &&
      typeof (c as Commit).date === 'number' &&
      typeof (c as Commit).message === 'string' &&
      Array.isArray((c as Commit).parents),
  );
  return commits.length === value.commits.length ? { v: 1, at: value.at, commits } : undefined;
}

export interface CommitsDeps {
  readonly net: Pick<Net, 'text' | 'memo'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly signal: AbortSignal;
}

async function fetchCommits(net: CommitsDeps['net']): Promise<Commit[]> {
  const response = await net.text(COMMITS_URL, { headers: { accept: 'application/vnd.github+json' }, throwHttpErrors: false });
  if ((response.status === 403 || response.status === 429) && response.headers['x-ratelimit-remaining'] === '0') {
    const reset = Number(response.headers['x-ratelimit-reset']);
    throw new GitHubFailure('rate-limit', 'rate limited', Number.isFinite(reset) && reset > 0 ? reset * 1000 : null);
  }
  if (response.status !== 200) throw new GitHubFailure('http', `HTTP ${response.status}`);
  try {
    return parseCommits(JSON.parse(response.body) as unknown);
  } catch {
    throw new GitHubFailure('parse', 'an answer that could not be read');
  }
}

/**
 * The ten newest commits, newest first, from the session's copy when it is under 10 minutes
 * old, else from GitHub. Rejects with a GitHubFailure, a NetError, or the signal's reason.
 */
export async function recentCommits(deps: CommitsDeps): Promise<{ commits: readonly Commit[]; kept: boolean }> {
  const store = sessionStore();
  const now = deps.clock.now();
  const stored = store?.getJson(STORAGE_KEYS.github.key, readStored);
  if (stored !== undefined && now >= stored.at && now - stored.at < KEEP_MS) return { commits: stored.commits, kept: true };
  // Shared by every caller for 10 minutes, so it takes no signal; ^C still ends the wait.
  const asked = deps.net.memo(`github:${COMMITS_URL}`, KEEP_MS, () => fetchCommits(deps.net));
  const commits = await Promise.race([asked, whenAborted(deps.signal).then((reason) => Promise.reject(reason))]);
  store?.setJson(STORAGE_KEYS.github.key, { v: 1, at: now, commits } satisfies Stored);
  return { commits, kept: false };
}
