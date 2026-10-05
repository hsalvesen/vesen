import { parse } from './parser.ts';
import { ShellSyntaxError } from './lexer.ts';
const show = (w: any) => w.parts.map((p: any) => p.kind === 'var' ? `\${${p.name}}` : (p.quoted ? JSON.stringify(p.text) : p.text)).join('');
const cases = [
  `echo "hello $USER" 'it''s' > out.txt && cat out.txt | wc -l`,
  `ls -la ~/projects/*.md; echo $? || echo fail`,
  `FOO=bar env | grep FOO 2>/dev/null`,
  `cat < in.txt 2>&1 | sort -r >> log`,
  `echo a\\ b "c \\"d\\"" \${HOME}/x`,
  `! false && echo negated`,
  `echo "unterminated`,
  `ls |`,
  `| ls`,
  `echo > `,
  `echo hi # comment`,
];
for (const c of cases) {
  try {
    const s = parse(c);
    console.log('OK  ', c, '\n     ', s.items.map(a => [a.first, ...a.rest.map(r => (r.op + ' ' ) as any && r.pipeline)].map((pl: any) => (pl.negated ? '! ' : '') + pl.commands.map((sc: any) => `[${sc.assigns.map((x: any) => x.name + '=' + show(x.value)).join(' ')}${sc.words.map(show).join(' ')}${sc.redirects.map((r: any) => ' ' + r.op + (r.target ? show(r.target) : '')).join('')}]`).join(' | ')).join(' &&|| ')).join(' ; '));
  } catch (e) { if (e instanceof ShellSyntaxError) console.log('ERR ', c, '->', e.message, 'incomplete=' + e.incomplete); else throw e; }
}
