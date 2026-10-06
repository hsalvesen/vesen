import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from './html-to-text';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('&lt;stdio.h&gt; &amp; &quot;x&quot; &#39;y&#39; &#x1F327;')).toBe(
      '<stdio.h> & "x" \'y\' 🌧',
    );
  });

  it('decodes once, so an escaped entity stays escaped', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('leaves unknown names as typed and replaces impossible code points', () => {
    expect(decodeEntities('&bogus; &#0; &#xD800; &#x110000;')).toBe('&bogus; � � �');
  });
});

describe('htmlToText', () => {
  it('strips tags and keeps text in order', () => {
    expect(htmlToText('<span style="color: var(--theme-red)">red</span> and <b>bold</b>')).toBe('red and bold');
  });

  it('turns <br> and block boundaries into single line breaks', () => {
    expect(htmlToText('a<br>b<br/>c<BR />d')).toBe('a\nb\nc\nd');
    expect(htmlToText('<div>a</div><div>b</div>')).toBe('a\nb');
    expect(htmlToText('x<div>a</div>y')).toBe('x\na\ny');
    expect(htmlToText('<p>a</p><br><p>b</p>')).toBe('a\n\nb');
  });

  it('keeps newlines inside text, as whitespace-pre output does', () => {
    expect(htmlToText('line 1\nline 2\n')).toBe('line 1\nline 2');
  });

  it('turns non-breaking spaces into spaces and trims each line', () => {
    expect(htmlToText('a&nbsp;&nbsp;b  \nc   ')).toBe('a  b\nc');
  });

  it('reads attribute values that contain > or quotes', () => {
    expect(htmlToText('<span title="a > b" data-x=\'"\'>ok</span>')).toBe('ok');
  });

  it('treats a lone < as text', () => {
    expect(htmlToText('1 < 2 and 3 <= 4')).toBe('1 < 2 and 3 <= 4');
  });

  it('drops comments, scripts and styles', () => {
    expect(htmlToText('a<!-- hidden -->b<script>alert(1)</script>c<style>p{}</style>d')).toBe('abcd');
  });

  it('removes trailing blank lines', () => {
    expect(htmlToText('a<br><br><br>')).toBe('a');
    expect(htmlToText('')).toBe('');
  });
});
