// fastfetch's logos: art for the visitor's system, loaded only when fastfetch draws one, so they
// stay out of every other chunk. Each is one colour, as the art block draws it.

import type { Colour } from '../../output/model';

export interface Logo {
  readonly art: string;
  /** What a screen reader hears instead of the art. */
  readonly alt: string;
  readonly colour: Colour;
}

const art = (rows: readonly string[]): string => rows.join('\n');

const APPLE = art([
  "                    'c.",
  "                 ,xNMM.",
  "               .OMMMMo",
  "               OMMM0,",
  "     .;loddo:' loolloddol;.",
  "   cKMMMMMMMMMMNWMMMMMMMMMM0:",
  " .KMMMMMMMMMMMMMMMMMMMMMMMWd.",
  " XMMMMMMMMMMMMMMMMMMMMMMMX.",
  ";MMMMMMMMMMMMMMMMMMMMMMMM:",
  ":MMMMMMMMMMMMMMMMMMMMMMMM:",
  ".MMMMMMMMMMMMMMMMMMMMMMMMX.",
  " kMMMMMMMMMMMMMMMMMMMMMMMMWd.",
  " .XMMMMMMMMMMMMMMMMMMMMMMMMMMk",
  "  .XMMMMMMMMMMMMMMMMMMMMMMMMK.",
  "    kMMMMMMMMMMMMMMMMMMMMMMd",
  "     ;KMMMMMMMWXXWMMMMMMMk.",
  "       .cooc,.    .,coo:.",
]);

const ANDROID = art([
  "           -o        o-",
  "           +hydNNNNdyh+",
  "         +mMMMMMMMMMMMMm+",
  "       `dM{  }mMMMMm{  }Md`",
  "       hMMMMMMMMMMMMMMMMMMh",
  "   ..  yyyyyyyyyyyyyyyyyyyy  ..",
  " .mMMm`MMMMMMMMMMMMMMMMMMMM`mMMm.",
  " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
  " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
  " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
  " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
  " -MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM-",
  "  +yy+ MMMMMMMMMMMMMMMMMMMM +yy+",
  "       mMMMMMMMMMMMMMMMMMMm",
  "        `++MMMMh+++hMMMM++`",
  "           MMMMo   oMMMM",
  "           MMMMo   oMMMM",
  "           oNMm-   -mMNo",
]);

const WINDOWS = art([
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
  "###############   ###############",
]);

const LINUX = art([
  "                 .88888888:.",
  "                88888888.88888.",
  "              .8888888888888888.",
  "              888888888888888888",
  "              88' _`88'_  `88888",
  "              88 88 88 88  88888",
  "              88_88_::_88_:88888",
  "              88:::,::,:::::8888",
  "              88`:::::::::'`8888",
  "             .88  `::::'    8:88.",
  "            8888            `8:888.",
  "          .8888'             `888888.",
  "         .8888:..  .::.  ...:'8888888:.",
  "        .8888.'     :'     `'::`88:88888",
  "       .8888        '         `.888:8888.",
  "      888:8         .           888:88888",
  "    .888:88        .:           888:88888:",
  "    8888888.       ::           88:888888",
  "    `.::.888.      ::          .88888888",
  "   .::::::.888.    ::         :::`8888'.:.",
  "  ::::::::::.888   '         .::::::::::::",
  "  ::::::::::::.8    '      .:8::::::::::::",
  " .::::::::::::::.        .:888:::::::::::",
  " :::::::::::::::88:.__..:88888::::::::::",
  "  `'.:::::::::::88888888888.88:::::::::",
  "       `':::_:' -- '' -'-' `':_::::'`",
]);

/** The logo for an OS as SysSnapshot names it; Linux's for anything else. */
export function logoFor(os: string): Logo {
  switch (os) {
    case 'macOS':
    case 'iOS':
    case 'iPadOS':
      return { art: APPLE, alt: `${os} logo`, colour: 'green' };
    case 'Android':
      return { art: ANDROID, alt: 'Android logo', colour: 'green' };
    case 'Windows':
      return { art: WINDOWS, alt: 'Windows logo', colour: 'blue' };
    default:
      return { art: LINUX, alt: 'Linux logo', colour: 'yellow' };
  }
}
