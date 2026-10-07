// The body of cowsay and cowthink; their specs, in cowsay.ts and cowthink.ts, load this the first
// time either runs. The animals and the bubble are in commands/lib/cows.ts.

import { out } from '../../../output/model';
import { stripSgr } from '../../../output/sgr';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { COW_NAMES, COWS, cowsay, DEFAULT_FACE, findCow, messageLines, MOODS, type Cow, type Face } from '../../lib/cows';

const ANIMALS_SECTION = {
  heading: 'ANIMALS',
  body: `${COW_NAMES.join(', ')}. Each was drawn for vesen. A side-on animal shows only the first of the two eyes -e gives it.`,
};

/** What --help, help and man say about cowsay, besides its spec (cowsay.ts). */
export const sayDoc: CommandDoc = {
  description:
    'Draws an animal saying MESSAGE in a speech bubble. With no MESSAGE it says what is piped into it, so fortune | cowsay works; with nothing piped in either, it says hello in its own way. The message is wrapped before column 40, or before the edge of a narrower screen; -W sets the column and -n keeps the lines as they are. -e and -T change the eyes and tongue, and the mood flags (-b, -d, -g, -p, -s, -t, -w, -y) set them for you.',
  man: [ANIMALS_SECTION, { heading: 'EXIT STATUS', body: '0 when the animal spoke; 1 for an animal that is not here; 2 for a bad option.' }],
};

/** What --help, help and man say about cowthink, besides its spec (cowthink.ts). */
export const thinkDoc: CommandDoc = {
  description:
    'Draws an animal thinking MESSAGE in a thought bubble, with little circles leading up to it. Everything else is as cowsay: the animals, the eyes, the tongue and the wrapping.',
  man: [ANIMALS_SECTION, { heading: 'EXIT STATUS', body: '0 when the animal thought; 1 for an animal that is not here; 2 for a bad option.' }],
};

/** The mood flags, in the order they are looked at: the first one given wins. */
const MOOD_FLAGS: readonly [string, string][] = [
  ['b', 'borg'],
  ['d', 'dead'],
  ['g', 'greedy'],
  ['p', 'paranoid'],
  ['s', 'stoned'],
  ['t', 'tired'],
  ['w', 'wired'],
  ['y', 'youthful'],
];

/** The eyes and tongue from -e, -T and the first mood flag given. */
export function faceFrom(opts: CommandContext['opts']): Face {
  const eyes = typeof opts.e === 'string' ? opts.e : DEFAULT_FACE.eyes;
  const tongue = typeof opts.T === 'string' ? opts.T : DEFAULT_FACE.tongue;
  const mood = MOOD_FLAGS.find(([flag]) => opts[flag] === true);
  const set = mood === undefined ? {} : (MOODS[mood[1]] ?? {});
  return { eyes: set.eyes ?? eyes, tongue: set.tongue ?? tongue };
}

/** The column the message wraps before: -W, else 40, or less where the screen is narrower. */
function wrapColumn(ctx: CommandContext): number {
  if (typeof ctx.opts.W === 'number') return ctx.opts.W;
  return ctx.stdout.isTTY ? Math.min(40, Math.max(12, ctx.stdout.columns - 3)) : 40;
}

function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function speak(ctx: CommandContext, think: boolean): Promise<ExitCode> {
  if (ctx.opts.l === true) {
    await ctx.stdout.write(`${COW_NAMES.join(' ')}\n`);
    return 0;
  }

  let cow: Cow | undefined;
  if (ctx.opts.r === true) cow = COWS[Math.floor(ctx.clock.random() * COWS.length)];
  else {
    const name = typeof ctx.opts.f === 'string' ? ctx.opts.f : 'cow';
    cow = findCow(name);
    if (cow === undefined) {
      const status = await ctx.fail(`no animal called '${name}'`);
      if (ctx.stderr.isTTY) await ctx.stderr.line(out.span(`'${ctx.name} -l' lists them.`, { fg: 'muted' }));
      return status;
    }
  }
  if (cow === undefined) return 1;

  const wrapAt = wrapColumn(ctx);
  if (!Number.isInteger(wrapAt) || wrapAt < 2) return ctx.usage(`invalid width '${String(ctx.opts.W)}'`);

  let message: string;
  if (ctx.args.length > 0) message = ctx.args.join(' ');
  else if (ctx.stdin.isTTY) message = cow.greeting;
  else message = stripSgr(await ctx.stdin.text());

  const options = { cow, face: faceFrom(ctx.opts), think, wrapAt, wrap: ctx.opts.n !== true };
  const picture = cowsay(message, options);
  const said = messageLines(message, options).join(' ').trim();
  const alt = `${capitalised(cow.name)} ${think ? 'thinks' : 'says'}: ${said === '' ? '(nothing)' : said}`;
  await ctx.stdout.block(out.art(picture, alt, 'scale'));
  return 0;
}

export function say(ctx: CommandContext): Promise<ExitCode> {
  return speak(ctx, false);
}

export function think(ctx: CommandContext): Promise<ExitCode> {
  return speak(ctx, true);
}
