// keys: the phone dock's key bar setting (docs/plan/04, "Dock, chips and key bar").
import { describe, expect, it } from 'vitest';
import { harness, stubAppearance } from '../../testing/shell-harness';
import help from '../shell/help';
import keys, { describeKeyBar } from './keys';

describe('keys', () => {
  it('says which setting is in force, and what it comes to', async () => {
    const h = harness({ specs: [keys, help] });
    const shown = await h.run('keys');
    expect(shown.status).toBe(0);
    expect(shown.stdout).toContain('Key bar: auto.');
    expect(shown.stdout).toContain('The key bar is part of the dock on touch screens.');
  });

  it('sets auto, on or off in any case, and refuses anything else', async () => {
    const h = harness({ specs: [keys, help] });
    const on = await h.run('keys ON');
    expect(on.status).toBe(0);
    expect(on.stdout).toContain('Key bar set to on (always shown).');
    const bad = await h.run('keys sometimes');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('keys: sometimes: not a setting');
    expect(bad.stderr).toContain('Choose one of: auto, on, off.');
    const extra = await h.run('keys on off');
    expect(extra.status).toBe(1);
    expect(extra.stderr).toContain("extra operand 'off'");
  });

  it('describes each setting, on a touch screen and off one', () => {
    const appearance = stubAppearance();
    expect(describeKeyBar(appearance.keyBar(), true)).toBe('auto (shown until a hardware keyboard is used)');
    expect(describeKeyBar(appearance.keyBar(), false)).toBe('auto');
    appearance.hardware = true;
    expect(describeKeyBar(appearance.keyBar(), true)).toBe('auto (hidden: a hardware keyboard was used)');
    expect(describeKeyBar({ mode: 'off', hardware: false, shown: false }, true)).toBe('off (never shown; the chips stay)');
  });

  it("answers --help as 'help keys' does: the keys, then the key bar", async () => {
    const h = harness({ specs: [keys, help] });
    const topic = await h.run('help keys');
    const own = await h.run('keys --help');
    expect(own.stdout).toBe(topic.stdout);
    expect(topic.stdout).toContain('Ctrl+R');
    expect(topic.stdout).toContain('keys - show or hide the key bar on touch screens');
  });

  it('completes its settings', () => {
    const values = keys.args?.[0]?.source;
    expect(values?.kind === 'enum' ? values.values().map((v) => v.value) : []).toEqual(['auto', 'on', 'off']);
  });
});
