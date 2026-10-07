// What qr encodes for what was typed (docs/plan/06-qr.md, "Payload rules").
import { describe, expect, it } from 'vitest';
import { classifyPayload, HTTPS_NOTE } from './qr-payload';

describe('classifyPayload', () => {
  it.each([
    ['vesen.app', 'https://vesen.app'],
    ['www.wikipedia.org/wiki/Computer_terminal', 'https://www.wikipedia.org/wiki/Computer_terminal'],
    ['localhost:5173/x', 'https://localhost:5173/x'],
    ['localhost', 'https://localhost'],
    ['vesen.app:8080?q=1#top', 'https://vesen.app:8080?q=1#top'],
    ['münchen.de', 'https://münchen.de'],
    ['hello.world', 'https://hello.world'],
  ])('gives the bare host %s https://', (raw, value) => {
    expect(classifyPayload(raw)).toEqual({ value, kind: 'link', note: HTTPS_NOTE });
  });

  it.each([
    ['https://tldr.sh', 'link'],
    ['HTTP://X', 'link'],
    ['mailto:has@salvesen.app', 'link'],
    ['tel:+61412345678', 'link'],
    ['sms:+61412345678', 'link'],
    ['geo:-33.86,151.21', 'link'],
    ['ftp://example.com/file', 'link'],
    ['WIFI:T:WPA;S:my net;P:secret;;', 'text'],
    ['BEGIN:VCARD\nVERSION:3.0\nFN:Has\nEND:VCARD', 'text'],
    ['otpauth://totp/vesen?secret=ABC', 'text'],
  ])('keeps the scheme of %s as typed', (raw, kind) => {
    expect(classifyPayload(raw)).toEqual({ value: raw, kind });
  });

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:void(0)', 'vbscript:msgbox(1)'])('refuses %s', (raw) => {
    expect(classifyPayload(raw)).toEqual({ error: `won't encode ${raw.trim().split(':')[0]!.toLowerCase()}: links` });
  });

  it('refuses javascript: even as text or a link', () => {
    expect(classifyPayload('javascript:alert(1)', { force: 'text' })).toHaveProperty('error');
    expect(classifyPayload('javascript:alert(1)', { force: 'url' })).toHaveProperty('error');
  });

  it('encodes the name of a file here as text, with a tip', () => {
    const fileExists = (name: string) => name === 'README.md';
    expect(classifyPayload('README.md', { fileExists })).toEqual({
      value: 'README.md',
      kind: 'text',
      tip: 'tip: README.md is a file here; this code contains the name, not the contents',
    });
    // Without the file, it is a host (.md is Moldova's domain).
    expect(classifyPayload('README.md')).toMatchObject({ value: 'https://README.md', kind: 'link' });
  });

  it('keeps an email address as text, with a tip to use mailto:', () => {
    expect(classifyPayload('has@salvesen.app')).toEqual({
      value: 'has@salvesen.app',
      kind: 'text',
      tip: 'tip: use qr mailto:has@salvesen.app for a tap-to-email code',
    });
  });

  it('keeps a phone number as text, with a tip to use tel:', () => {
    expect(classifyPayload('+61 412 345 678')).toEqual({
      value: '+61 412 345 678',
      kind: 'text',
      tip: 'tip: use qr tel:+61412345678 for a tap-to-call code',
    });
    expect(classifyPayload('(02) 9876-5432')).toMatchObject({ tip: 'tip: use qr tel:0298765432 for a tap-to-call code' });
  });

  it.each(['v1.2.0', '3.14', '1.2.3', 'hello. world', 'e.g.', 'hello', '2026-10-07', '12345', 'Kia ora 🦉', '<u>x</u>', '192.168.1.1'])(
    'encodes %s as literal text',
    (raw) => {
      expect(classifyPayload(raw)).toEqual({ value: raw, kind: 'text' });
    },
  );

  it('follows --text and --url', () => {
    expect(classifyPayload('vesen.app', { force: 'text' })).toEqual({ value: 'vesen.app', kind: 'text' });
    expect(classifyPayload('has@salvesen.app', { force: 'text' })).toEqual({ value: 'has@salvesen.app', kind: 'text' });
    expect(classifyPayload('vesen.app', { force: 'url' })).toEqual({ value: 'https://vesen.app', kind: 'link', note: HTTPS_NOTE });
    expect(classifyPayload('https://vesen.app', { force: 'url' })).toEqual({ value: 'https://vesen.app', kind: 'link' });
    expect(classifyPayload('README.md', { force: 'url', fileExists: () => true })).toMatchObject({ value: 'https://README.md' });
    expect(classifyPayload('hello world', { force: 'url' })).toEqual({ error: "--url needs a link, such as vesen.app (got 'hello world')", usage: true });
  });
});
