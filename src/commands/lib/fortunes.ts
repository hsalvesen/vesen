// What fortune says: short lines about computers, terminals and the shell, and a few about the
// animals the themes are named after, all written for vesen. Loaded only with fortune's body.
// A fortune with a line break in it is long, whatever its length, and `fortune -s` skips it.

export const FORTUNES: readonly string[] = [
  // Computers, code and the craft.
  'Your code works. Do not touch it until Monday.',
  'The bug is not in the compiler. It is never in the compiler.',
  'A clean build is a promise, not a guarantee.',
  'Every TODO is a letter to a future you who is busier than you are.',
  'Semicolons are optional until they are not.',
  'The shortest path between two bugs is a quick fix.',
  "Today's forecast: a strong chance of merge conflicts by afternoon.",
  'Two spaces or four? Yes.',
  'Undo is the most underrated feature ever shipped.',
  'If it compiles on the first try, check that you saved the file.',
  'The best code is the code you deleted this morning.',
  'Logs do not lie, but they do leave things out.',
  'It worked on my machine. Your machine has been notified.',
  'Every folder named misc is a cry for help.',
  'Write the test first. Then write the excuse.',
  'Comments say why. Code says what. Bugs say everything else.',
  'Friday deploys are a fine way to meet the weekend on-call team.',
  'Whitespace is free. Let your code breathe.',
  'Somewhere, a pattern you wrote last year is still matching the wrong thing.',
  'Real programmers read the error message. Eventually.',
  'A script with no comments is a puzzle with no picture on the box.',
  'Today you will find the missing bracket.',
  'A tidy desktop means a crowded downloads folder.',
  'The cache remembers so you do not have to, until the worst possible moment.',
  'Small commits, long sleeps.',
  'Your future self is reading this code. Be kind.',
  'A good variable name is worth a hundred comments.',
  'Version 1.0 is when the features stop and the fixes start.',
  'Rebooting is a form of meditation.',
  'There is a flag for that. There is always a flag for that.',
  'Dark mode: the terminal was right all along.',
  'A pull request with one line changed gets forty comments. One with four thousand gets a thumbs up.',
  'Naming things is easy. Renaming them everywhere is the hard part.',
  'The meeting could have been a commit message.',
  'Nobody remembers who wrote the oldest script. Everybody runs it.',

  // The terminal and the shell.
  'Tab completion: because life is too short to type the whole word.',
  'rm -i: for when you trust yourself, but not that much.',
  'Ctrl+C is not a plan, but it is a start.',
  'The cursor blinks so you know it is still listening.',
  'grep finds what you lost. history shows how you lost it.',
  'Start a line with a space and history forgets it ever happened.',
  '/dev/null accepts everything and judges nothing.',
  'chmod 777 is not a personality.',
  'sleep is just a timeout with better manners.',
  'Your terminal misses you whenever you reach for the mouse.',
  'A pipe is a promise that someone will read what you write.',
  'The prompt is patient. The deadline is not.',
  'Exit status 0: the sweetest number in computing.',
  'Exit status 127: the command you seek is not here.',
  'Home is where your ~ is.',
  'cd with no arguments always brings you home.',
  'Ctrl+R: the time machine in your shell.',
  'In a terminal everything is a file, even your regrets.',
  '!! repeats your last command. Sometimes that includes the mistake.',
  'sort | uniq -c | sort -n: three steps to understanding almost anything.',
  'Every endless loop ends eventually, usually with Ctrl+C.',
  'Read the man page first, and the afternoon is yours.',
  'Type help and help will come.',
  'sudo will not make you a sandwich here. Probably.',
  'The quickest way out of a full-screen program is to remember which one it is.',
  'clear hides the mess. It does not clean it up.',
  'A dotfile is a secret you keep from ls but not from ls -a.',
  'Aliases are how a shell learns your accent.',

  // The animals the themes are named after.
  'A wombat burrow has one entrance and no merge conflicts.',
  'Somewhere a kookaburra is laughing at your build times.',
  'The cassowary needs no firewall. The cassowary is the firewall.',
  'A kangaroo cannot easily walk backwards, which is why it never reverts a commit.',
  'Wombats leave cube-shaped droppings: proof that nature loves a grid layout.',
  'The crocodile has kept the same design for millions of years. No refactor needed.',
  'A cockatoo can live for decades. So can a quick fix.',
  'The tree frog stays green, like a passing test.',

  // A few that take more than a line.
  'Q: How many terminals does it take to change a light bulb?\nA: One, but it needs sudo.',
  'Roses are #ff0000,\nviolets are #0000ff,\nI wrote you a shell script\nand it is mostly comments.',
  'connection refused\nthe server sleeps, as do I\nretrying at dawn',
  'Dear diary,\ntoday I renamed a variable\nand forty files changed.',
];

/** Short enough for `fortune -s`: one line of at most this many characters. */
export const SHORT_MAX = 60;

export function isShort(fortune: string): boolean {
  return !fortune.includes('\n') && fortune.length <= SHORT_MAX;
}

/** One fortune from `pool`, chosen with `random` (a number in [0, 1)). */
export function pickFortune(pool: readonly string[], random: () => number): string {
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index] ?? '';
}
