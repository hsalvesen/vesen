// Link cards for the portfolio commands (docs/plan/04-phone-and-instagram.md, "Inside Instagram's
// browser"; designs/phone-and-instagram.md, "G. Links, email and in-app fallbacks"). Every opener
// prints a card with Copy. On a desktop browser the spec's opens() has already opened the link in a
// new tab inside the Enter that ran the line, and a dim note under the card says so; elsewhere the
// card is the way there, and in an in-app browser it opens in the same view so Back returns.

import { out, type CardBlock } from '../../output/model';
import type { CommandContext } from '../../shell/types';
import { OWNER_LINKS } from '../../vfs/identity';

export const LINKEDIN_URL: string = OWNER_LINKS.linkedin;
export const GITHUB_URL: string = OWNER_LINKS.github;
export const REPO_URL: string = OWNER_LINKS.repo;
export const EMAIL_ADDRESS: string = OWNER_LINKS.email;

/** The owner's address with a subject carrying the time, so threads stay apart. */
export function mailHref(now: number): string {
  const stamp = new Date(now).toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `mailto:${EMAIL_ADDRESS}?subject=${encodeURIComponent(`Terminal Contact - ${stamp}`)}`;
}

/** A card for a web link. */
export function webCard(title: string, url: string): CardBlock {
  return out.card({ title, href: url });
}

/**
 * The email card: [✉ Open mail app] as a real mailto link and [⧉ Copy address]. Inside an
 * in-app browser, where the mail app may not open, a hint and the way out to the real browser.
 */
export function emailCard(ctx: Pick<CommandContext, 'clock' | 'tty'>): CardBlock {
  return out.card({
    title: 'Email',
    href: mailHref(ctx.clock.now()),
    label: EMAIL_ADDRESS,
    copy: EMAIL_ADDRESS,
    copyLabel: '⧉ Copy address',
    openLabel: '✉ Open mail app',
    ...(ctx.tty.inApp === null
      ? {}
      : { escape: { url: OWNER_LINKS.site, hint: "If the mail app doesn't open, copy the address, or open vesen.app in the browser:" } }),
  });
}

/**
 * The card for an opener, then what happened to the tab the spec's opens() asked for: a dim
 * '(opened in a new tab)' on a desktop browser, a warning if the browser blocked it, and nothing
 * where only the card is shown.
 */
export async function openerCard(ctx: CommandContext, card: CardBlock, url: string = card.href): Promise<void> {
  const opened = await ctx.tty.open(url, card.title);
  await ctx.stdout.block(card);
  if (opened === 'opened') await ctx.stdout.line(out.span('(opened in a new tab)', { fg: 'muted' }));
  else if (opened === 'blocked') await ctx.stdout.line(out.span('(the browser blocked the new tab: use the link above)', { fg: 'warn' }));
}
