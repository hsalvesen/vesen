// The bodies of the portfolio's link commands, loaded the first time one runs (or when the page is
// idle): whoami, linkedin, about, contact and email, repo, open and xdg-open. Each prints link
// cards (commands/lib/cards.ts); in a pipe or a file each prints plain text instead.

import { out } from '../../output/model';
import type { CommandContext, ExitCode } from '../../shell/types';
import { OWNER } from '../../vfs/identity';
import { emailCard, EMAIL_ADDRESS, GITHUB_URL, LINKEDIN_URL, openerCard, REPO_URL, webCard } from '../lib/cards';
import { webUrl } from '../lib/web-url';

/** Commands that take no operands say so, as coreutils does. */
async function noOperands(ctx: CommandContext): Promise<ExitCode | null> {
  const [extra] = ctx.args;
  return extra === undefined ? null : ctx.usage(`extra operand '${extra}'`);
}

/** The owner's name, then a card each for LinkedIn, GitHub and email. */
export async function whoami(ctx: CommandContext): Promise<ExitCode> {
  const extra = await noOperands(ctx);
  if (extra !== null) return extra;
  if (!ctx.stdout.isTTY) {
    await ctx.stdout.write(`${ctx.user.name}\n`);
    return 0;
  }
  await ctx.stdout.line(out.span(OWNER.fullName, { bold: true, fg: 'fg-strong' }));
  await openerCard(ctx, webCard('LinkedIn', LINKEDIN_URL));
  await ctx.stdout.block(webCard('GitHub', GITHUB_URL));
  await ctx.stdout.block(emailCard(ctx));
  return 0;
}

export async function linkedin(ctx: CommandContext): Promise<ExitCode> {
  const extra = await noOperands(ctx);
  if (extra !== null) return extra;
  if (!ctx.stdout.isTTY) await ctx.stdout.write(`${LINKEDIN_URL}\n`);
  else await openerCard(ctx, webCard('LinkedIn', LINKEDIN_URL));
  return 0;
}

export async function repo(ctx: CommandContext): Promise<ExitCode> {
  const extra = await noOperands(ctx);
  if (extra !== null) return extra;
  if (!ctx.stdout.isTTY) await ctx.stdout.write(`${REPO_URL}\n`);
  else await openerCard(ctx, webCard('vesen on GitHub', REPO_URL));
  return 0;
}

/** contact and email: the address, with Open mail app and Copy address. Nothing opens by itself. */
export async function contact(ctx: CommandContext): Promise<ExitCode> {
  const extra = await noOperands(ctx);
  if (extra !== null) return extra;
  if (!ctx.stdout.isTTY) await ctx.stdout.write(`${EMAIL_ADDRESS}\n`);
  else await ctx.stdout.block(emailCard(ctx));
  return 0;
}

/** The developer's own summary, printed by cat itself, then the cards. */
export async function about(ctx: CommandContext): Promise<ExitCode> {
  const extra = await noOperands(ctx);
  if (extra !== null) return extra;
  const status = await ctx.shell.exec(`cat ${OWNER.home}/about.md`);
  if (status !== 0) return status;
  if (ctx.stdout.isTTY) {
    await ctx.stdout.block(webCard('LinkedIn', LINKEDIN_URL));
    await ctx.stdout.block(webCard('GitHub', GITHUB_URL));
    await ctx.stdout.block(emailCard(ctx));
  }
  return 0;
}

/** open and xdg-open: a card for the URL; a desktop browser has already opened it. */
export async function open(ctx: CommandContext): Promise<ExitCode> {
  const [word, extra] = ctx.args;
  if (word === undefined) return ctx.usage('a URL is required');
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  // A file in vesen is read, not opened: open README.md is never https://README.md.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(word) && ctx.fs.exists(ctx.resolve(word))) {
    return ctx.fail(`${word}: a file, not a web link; try 'cat ${word}'`);
  }
  const url = webUrl(word);
  if (url === null) return ctx.fail(`${word}: not a web link (http, https or mailto)`);
  if (!ctx.stdout.isTTY) {
    await ctx.stdout.write(`${url}\n`);
    return 0;
  }
  const external = ctx.opts.external === true;
  const web = /^https?:/i.test(url);
  const card = out.card({
    title: web ? new URL(url).host.replace(/^www\./, '') : 'Email',
    href: url,
    ...(external && web && ctx.tty.inApp !== null ? { escape: { url, hint: 'To open it in the real browser:' } } : {}),
  });
  await openerCard(ctx, card, url);
  if (external && ctx.tty.inApp === null) {
    await ctx.stdout.line(out.span('(this is already the real browser)', { fg: 'muted' }));
  }
  return 0;
}
