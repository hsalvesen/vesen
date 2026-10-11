import { expect, test, type Page } from '@playwright/test';

// The line editor (docs/plan/03-terminal-input.md, "Controller and line editor" and "Readline,
// keymap and history store"; 02, sections 5 and 12): the block cursor and ghost on a desktop,
// readline keys, reverse search, selection-aware Ctrl+C, and on phones a native input that keeps
// focus, and the keyboard, across commands.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.locator('input.command-input');
const echoes = (page: Page) => page.locator('[role="log"] .command-input-display');
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();

/** A tap on the prompt: the only thing on a phone that opens the keyboard. */
async function tapPrompt(page: Page): Promise<void> {
  await prompt(page).tap();
  await expect(prompt(page)).toBeFocused();
}

/** Opens the terminal with the kernel and the completion engine loaded. */
async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
}

/** Types a line at the prompt and waits until it has run. */
async function run(page: Page, line: string): Promise<void> {
  const before = await echoes(page).count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes(page)).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

test.describe('the line editor on a desktop', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(isPhone(), 'a mouse and a hardware keyboard');
  });

  test('draws a block cursor in the cursor colour, where the caret is', async ({ page }) => {
    await open(page);
    await expect(prompt(page)).toBeFocused();
    for (const line of ['l', 'echo '.repeat(8).trim()]) {
      await prompt(page).fill('');
      await page.keyboard.type(line);
      const measured = await prompt(page).evaluate((element) => {
        const input = element as HTMLInputElement;
        const cursor = document.querySelector('.mirror .cursor') as HTMLElement;
        const mirror = document.querySelector('.mirror') as HTMLElement;
        const canvas = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
        const style = getComputedStyle(input);
        canvas.font = `${style.fontSize} ${style.fontFamily}`;
        return {
          visible: cursor.getBoundingClientRect().width > 0,
          background: getComputedStyle(cursor).backgroundColor,
          caret: style.caretColor,
          // Where the block is, against where the input's own caret would be.
          offset: cursor.getBoundingClientRect().left - mirror.getBoundingClientRect().left + mirror.scrollLeft,
          caretAt: canvas.measureText(input.value.slice(0, input.selectionStart ?? 0)).width,
        };
      });
      expect(measured.visible).toBe(true);
      expect(measured.background).toBe('rgb(255, 255, 255)');
      expect(measured.caret).toBe('rgba(0, 0, 0, 0)');
      expect(Math.abs(measured.offset - measured.caretAt), line).toBeLessThanOrEqual(1);
    }
  });

  test('a long line scrolls sideways with the cursor always in view, and the mirror in step', async ({ page }) => {
    await open(page);
    await page.keyboard.type(`echo ${'abcdefghij'.repeat(20)}`);
    const view = () =>
      page.evaluate(() => {
        const input = document.querySelector('input.command-input') as HTMLInputElement;
        const mirror = document.querySelector('.mirror') as HTMLElement;
        const cursor = (mirror.querySelector('.cursor') as HTMLElement).getBoundingClientRect();
        const box = mirror.getBoundingClientRect();
        return {
          inView: cursor.left >= box.left - 0.5 && cursor.right <= box.right + 0.5,
          inStep: input.scrollLeft === mirror.scrollLeft,
          scrolled: mirror.scrollLeft > 0,
        };
      });
    await expect.poll(view).toEqual({ inView: true, inStep: true, scrolled: true });
    // Moved by the prompt rather than typed: the browser would leave the caret out of view.
    await page.keyboard.press('Control+a');
    await expect.poll(view).toEqual({ inView: true, inStep: true, scrolled: false });
    await page.keyboard.press('Control+e');
    await expect.poll(view).toEqual({ inView: true, inStep: true, scrolled: true });
  });

  test('a grey ghost offers the rest of a past line, and Right takes it', async ({ page }) => {
    await open(page);
    await run(page, 'echo ghostly');
    await page.keyboard.type('echo gh');
    // The block cursor sits on the ghost's first letter.
    await expect(page.locator('.mirror .ghost-zone')).toHaveText('ostly');
    await expect(page.locator('.mirror .cursor')).toHaveText('o');
    await page.keyboard.press('ArrowRight');
    await expect(prompt(page)).toHaveValue('echo ghostly');
    await expect(page.locator('.mirror .ghost')).toHaveCount(0);
  });

  test('a click on the ghost takes it too', async ({ page }) => {
    await open(page);
    await run(page, 'echo clicked');
    await page.keyboard.type('echo cl');
    const ghost = page.locator('.mirror .ghost-zone');
    const box = await ghost.boundingBox();
    if (box === null) throw new Error('no ghost');
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    await expect(prompt(page)).toHaveValue('echo clicked');
  });

  test('Ctrl+R finds a past command and Enter runs it, without reloading the page', async ({ page }) => {
    await open(page);
    await run(page, 'echo needle');
    await run(page, 'pwd');
    await page.evaluate(() => ((window as Window & { stillHere?: boolean }).stillHere = true));

    await page.keyboard.press('Control+r');
    await page.keyboard.type('need');
    await expect(page.locator('.edit-row .read-prompt')).toHaveText('(reverse-i-search)`');
    await expect(page.locator('.mirror .match')).toHaveText('need');
    await page.keyboard.press('Enter');
    await expect(echoes(page).last()).toHaveText('echo needle');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('needle');
    expect(await page.evaluate(() => (window as Window & { stillHere?: boolean }).stillHere)).toBe(true);

    // Nothing found says so, and Escape puts back what was typed.
    await page.keyboard.type('draft');
    await page.keyboard.press('Control+r');
    await page.keyboard.type('zzz');
    await expect(page.locator('.edit-row .read-prompt')).toHaveText('(failed reverse-i-search)`');
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveValue('draft');
  });

  test('Ctrl+C with text selected is left to the browser to copy; without, it abandons the line', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const seen = ((window as Window & { ctrlC?: boolean[] }).ctrlC = [] as boolean[]);
      window.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'c') seen.push(event.defaultPrevented);
      });
    });
    const prevented = () => page.evaluate(() => (window as Window & { ctrlC?: boolean[] }).ctrlC ?? []);

    // Text selected in the output, with focus on it.
    await page.getByText('to see all available commands.').dblclick();
    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).not.toBe('');
    await page.keyboard.press('Control+c');

    // Text selected in the prompt.
    await prompt(page).focus();
    await page.keyboard.type('echo selected');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Control+c');
    await expect(prompt(page)).toHaveValue('echo selected');
    expect(await prevented()).toEqual([false, false]);
    await expect(echoes(page)).toHaveCount(1);

    // Nothing selected: the line is abandoned with ^C, as bash does.
    await page.keyboard.press('End');
    await page.keyboard.press('Control+c');
    await expect(echoes(page).last()).toHaveText('echo selected^C');
    await expect(prompt(page)).toHaveValue('');
  });

  test('Ctrl+L clears the screen and keeps the line', async ({ page }) => {
    await open(page);
    await run(page, 'echo before');
    await page.keyboard.type('echo kept');
    await page.keyboard.press('Control+l');
    await expect(echoes(page)).toHaveCount(0);
    await expect(prompt(page)).toHaveValue('echo kept');
    await expect(prompt(page)).toBeFocused();
  });

  test('readline keys cut and paste through the kill ring, and Up keeps the draft', async ({ page }) => {
    await open(page);
    await run(page, 'echo older');
    await page.keyboard.type('echo one two');
    await page.keyboard.press('Alt+Backspace');
    await expect(prompt(page)).toHaveValue('echo one ');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+k');
    await expect(prompt(page)).toHaveValue('');
    await page.keyboard.press('Control+y');
    await expect(prompt(page)).toHaveValue('echo one ');

    // Up offers only lines starting with what is typed, and Down brings the draft back.
    await page.keyboard.press('Control+u');
    await page.keyboard.type('echo o');
    await page.keyboard.press('ArrowUp');
    await expect(prompt(page)).toHaveValue('echo older');
    await page.keyboard.press('ArrowDown');
    await expect(prompt(page)).toHaveValue('echo o');
  });
});

test.describe('sudo', { tag: '@smoke' }, () => {
  const SECRET = 'hunter2-correct-horse';

  test('asks for a password it never keeps, then puts on the show and reports the incident', async ({ page, context }) => {
    await open(page);
    if (isPhone()) await tapPrompt(page);
    await prompt(page).fill('sudo ls');
    await prompt(page).press('Enter');

    await expect(page.locator('.edit-row .read-prompt')).toHaveText('[sudo] password for guest: ');
    await expect(page.locator('.prompt-line .hint')).toHaveText('(this is a joke; nothing you type is kept)');
    await expect(prompt(page)).toHaveAttribute('type', 'text');
    await expect(prompt(page)).toHaveAttribute('autocomplete', 'off');
    await expect(prompt(page)).toHaveAttribute('data-1p-ignore', '');
    await expect(prompt(page)).toHaveAttribute('data-lpignore', 'true');
    await prompt(page).pressSequentially(SECRET);
    // Masked: discs on touch, nothing at all in the desktop's mirror.
    const masked = await prompt(page).evaluate((input) => ({
      security: getComputedStyle(input).getPropertyValue('-webkit-text-security'),
      mirror: document.querySelector('.mirror')?.textContent ?? null,
    }));
    if (isPhone()) expect(masked.security).toBe('disc');
    else expect(masked.mirror).toBe(' ');

    // The Enter that answers opens the show over the terminal; nothing opens anywhere else. Esc
    // ends it, and the sudoers line follows (e2e/sudo.spec.ts has the rest of the show).
    await prompt(page).press('Enter');
    const show = page.getByRole('dialog', { name: 'You have been rickrolled' });
    await expect(show).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(show).toBeHidden();
    await expect(lastEntry(page)).toContainText('guest is not in the sudoers file. This incident will be reported.');
    await expect(lastEntry(page).locator('.card')).toHaveCount(0);
    expect(context.pages()).toHaveLength(1);
    if (!isPhone()) await expect(prompt(page)).toBeFocused();

    // The password went nowhere: not the page, storage, or history.
    const kept = await page.evaluate(
      (secret) => ({
        page: document.documentElement.outerHTML.includes(secret),
        local: JSON.stringify({ ...localStorage }).includes(secret),
        session: JSON.stringify({ ...sessionStorage }).includes(secret),
      }),
      SECRET,
    );
    expect(kept).toEqual({ page: false, local: false, session: false });
    expect(await page.evaluate(() => localStorage.getItem('vesen:history:v1'))).toContain('sudo ls');
  });

  test('never puts the password in the input’s value, so the accessibility tree has only bullets', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'the accessibility tree through Chromium’s DevTools protocol');
    await open(page);
    await prompt(page).fill('sudo ls');
    await prompt(page).press('Enter');
    await expect(page.locator('.edit-row .read-prompt')).toHaveText('[sudo] password for guest: ');
    await prompt(page).pressSequentially(SECRET);
    await expect(prompt(page)).toHaveValue('•'.repeat(SECRET.length));
    const client = await page.context().newCDPSession(page);
    await client.send('Accessibility.enable');
    const { nodes } = (await client.send('Accessibility.getFullAXTree')) as { nodes: { role?: { value?: string }; name?: { value?: string }; value?: { value?: unknown }; description?: { value?: string } }[] };
    const field = nodes.find((node) => node.role?.value === 'combobox');
    expect(field?.name?.value).toBe('[sudo] password for guest:');
    expect(String(field?.value?.value ?? '')).not.toContain('hunter');
    // Described by the dim line that says it is a joke.
    expect(field?.description?.value ?? '').toContain('nothing you type is kept');
    expect(JSON.stringify(nodes)).not.toContain(SECRET);
  });

  test('Cmd or Ctrl+Z afterwards never brings the password back', async ({ page }) => {
    test.skip(isPhone(), 'a hardware keyboard');
    await open(page);
    await prompt(page).fill('sudo ls');
    await prompt(page).press('Enter');
    await expect(page.locator('.edit-row .read-prompt')).toHaveText('[sudo] password for guest: ');
    await prompt(page).pressSequentially(SECRET);
    for (let i = 0; i < SECRET.length; i += 1) await prompt(page).press('Backspace');
    await prompt(page).press('Control+c');
    await expect(page.locator('.edit-row .read-prompt')).toHaveCount(0);
    for (const undo of ['ControlOrMeta+z', 'ControlOrMeta+z', 'ControlOrMeta+Shift+z']) {
      await prompt(page).press(undo);
      const shown = await page.evaluate(() => ({
        value: (document.querySelector('input.command-input') as HTMLInputElement).value,
        mirror: document.querySelector('.mirror')?.textContent ?? '',
      }));
      expect(shown.value).not.toContain('hunter');
      expect(shown.mirror).not.toContain('hunter');
    }
  });
});

test.describe('forced colours', { tag: '@smoke' }, () => {
  test('outline the Tab menu’s choice, which a fill alone cannot show', async ({ page }) => {
    test.skip(isPhone(), 'the desktop list');
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page);
    await prompt(page).fill('theme ');
    for (let i = 0; i < 3; i += 1) await prompt(page).press('Tab');
    const selected = page.locator('.completion-row .chip.selected');
    await expect(selected).toHaveCount(1);
    const outline = await selected.evaluate((chip) => ({ style: getComputedStyle(chip).outlineStyle, width: getComputedStyle(chip).outlineWidth }));
    expect(outline.style).toBe('solid');
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
    // In the dock too.
    await page.goto('/?dock=1');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    await prompt(page).fill('theme ');
    for (let i = 0; i < 3; i += 1) await page.locator('.dock .key[data-key="tab"]').click();
    const docked = page.locator('.dock .chip.selected');
    await expect(docked).toHaveCount(1);
    expect(await docked.evaluate((chip) => getComputedStyle(chip).outlineStyle)).toBe('solid');
  });
});

test.describe('the prompt on a phone', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(!isPhone(), 'phones only');
  });

  test('keeps focus, and so the keyboard, across three commands, and never zooms', async ({ page }) => {
    await open(page);
    await expect(prompt(page)).not.toBeFocused();
    await tapPrompt(page);
    for (const line of ['pwd', 'echo two', 'ls']) {
      await prompt(page).pressSequentially(line);
      await prompt(page).press('Enter');
      await expect(echoes(page).last()).toHaveText(line);
      await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
      await expect(prompt(page)).toBeFocused();
    }
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    expect(await prompt(page).evaluate((input) => getComputedStyle(input).fontSize)).toBe('16px');
  });

  test('tapping output never focuses the prompt', async ({ page }) => {
    await open(page);
    await page.getByText('to see all available commands.').tap();
    await expect(prompt(page)).not.toBeFocused();
    await tapPrompt(page);
    await run(page, 'help');
    // With the keyboard put away, output stays something to read.
    await prompt(page).evaluate((input) => input.blur());
    await page.getByText('to see all available commands.').tap();
    await expect(prompt(page)).not.toBeFocused();
  });
});
