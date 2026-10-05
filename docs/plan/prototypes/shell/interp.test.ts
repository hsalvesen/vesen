import { run } from './interp.ts';
const env = new Map([['USER', 'guest']]);
const cases = [
  'yes vesen | head -n 3',
  'cat a.txt | sort | uniq',
  'sort a.txt | uniq | wc',
  'cat nope.txt 2>/dev/null || echo "fallback $?"',
  'cat nope.txt; echo "status=$?"',
  'false && echo no || echo yes',
  'echo hi > b.txt; echo more >> b.txt; cat b.txt',
  'wc < a.txt',
  'foo | echo still runs; echo $?',
  '! false && echo negated',
];
for (const c of cases) { const t0 = Date.now(); const r = await run(c, env); console.log(JSON.stringify(c), '=>', JSON.stringify(r.out), r.err ? 'ERR:' + JSON.stringify(r.err) : '', 'rc=' + r.status, (Date.now() - t0) + 'ms'); }
