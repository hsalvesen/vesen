<!--
  The app shell: a column of the screen and, below it, the phone dock (on a touch screen, or with
  ?dock=1). The screen frame holds the scrolling transcript, the new-output pill and the CRT
  overlay, so the overlay covers the terminal and never the dock. The shell itself is sized to
  the visible viewport by styles/shell.css and platform/viewport.ts, so the dock rides on top of
  the soft keyboard. The dock loads in its own chunk, so a desktop never downloads it; until it
  arrives its room is kept, so nothing jumps, and if it never does the chips stay under the prompt.
  The completion row and the status line load just after the first paint, as the kernel does.

  Each line's entry is in the transcript from the moment it starts, its output arriving under it
  as the command writes it, and the status line under the line still running says what it is
  doing and stops it. A command's full-screen app (the Shutdown screen) is drawn by AppHost over
  all of it. Links and cards follow the opener's in-app policy, and when the page is put away the
  screen goes to the session snapshot, which boot restores after Back.
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import Cathode from './ui/Cathode.svelte';
  import type { Action } from './output/model';
  import { coarsePointer, dockWanted, keyPlatform } from './platform/env';
  import { createClipboard } from './services/clipboard';
  import { SNAPSHOT_KEY, type SessionSnapshot } from './services/session-snapshot';
  import type { AppRequest, ShellPort } from './shell/index';
  import { screen as transcript } from './stores/screen';
  import { provideLinkPolicy } from './ui/links';
  import type { AppPlatform } from './ui/platform';
  import PromptLine from './ui/prompt/PromptLine.svelte';
  import { PromptController } from './ui/prompt/promptController.svelte';
  import Transcript from './ui/Transcript.svelte';
  import { focusPolicy } from './ui/actions/focusPolicy';
  import { distanceFromBottom, PIN_THRESHOLD_PX, scrollToEnd, stickToBottom } from './ui/actions/stickToBottom';

  let { shell, platform }: { shell: ShellPort; platform?: AppPlatform } = $props();

  const win = typeof window === 'undefined' ? undefined : window;
  const dock = dockWanted(win);
  // svelte-ignore state_referenced_locally
  const { opener = null, clipboard: givenClipboard = null, session = null, restored = null } = platform ?? {};
  const clipboard = givenClipboard ?? createClipboard(win ?? {});

  // Links and cards: a new tab in a browser, the same view inside an in-app browser.
  provideLinkPolicy({
    target: opener?.inApp ? '_self' : '_blank',
    inApp: opener?.inApp ?? null,
    touch: coarsePointer(win),
    copy: (text) => clipboard.copy(text),
    escapeHref: (url) => opener?.escapeHref(url) ?? null,
    openExternal: (url) => {
      beforeLeaving();
      void opener?.openExternal(url);
    },
  });
  // The prompt: the line being typed, its keys, the running line and everything Tab offers.
  // svelte-ignore state_referenced_locally
  const prompt = new PromptController({ shell, screen: transcript, platform: keyPlatform(win?.navigator), touch: coarsePointer(win), dock });
  onDestroy(() => prompt.destroy());

  // The dock's chunk, on a touch screen only.
  let Dock: typeof import('./ui/dock/Dock.svelte').default | null = $state(null);
  let dockFailed = $state(false);
  if (dock) {
    import('./ui/dock/Dock.svelte').then(
      (module) => (Dock = module.default),
      () => (dockFailed = true),
    );
  }
  // Under the prompt: every chip but Stop (the status line stops a command), unless the dock
  // draws them.
  const inlineChips = $derived(Dock === null ? prompt.chipList.chips.filter((chip) => chip.action.kind !== 'interrupt') : []);

  // Tab's list and the chips under the prompt load in their own chunk just after the first
  // paint, as the status line does: nothing completes before the kernel is here.
  let CompletionRow: typeof import('./ui/CompletionRow.svelte').default | null = $state(null);
  let rowLoading = false;
  function loadCompletionRow(): void {
    if (rowLoading) return;
    rowLoading = true;
    import('./ui/CompletionRow.svelte').then(
      (module) => (CompletionRow = module.default),
      // Offline, say: tried again when there is something to show.
      () => (rowLoading = false),
    );
  }
  onMount(loadCompletionRow);
  $effect(() => {
    if (CompletionRow === null && (inlineChips.length > 0 || prompt.question !== null || prompt.announce !== '')) loadCompletionRow();
  });

  // The status line goes under the running line's entry; above the prompt only if that entry is
  // not on the screen. It loads in its own chunk just after the first paint, as the kernel does,
  // since nothing runs before the kernel is here.
  const runningEntry = $derived($transcript.some((entry) => entry.state === 'running'));
  let StatusLine: typeof import('./ui/StatusLine.svelte').default | null = $state(null);
  let statusLoading = false;
  function loadStatusLine(): void {
    if (statusLoading) return;
    statusLoading = true;
    import('./ui/StatusLine.svelte').then(
      (module) => (StatusLine = module.default),
      // Offline, say: the next command tries again.
      () => (statusLoading = false),
    );
  }
  onMount(loadStatusLine);
  $effect(() => {
    if (prompt.status !== null && StatusLine === null) loadStatusLine();
  });

  let screen: HTMLElement | undefined = $state();
  let newOutput = $state(false);

  // A full-screen app over the terminal (the Shutdown screen); the shell under it is inert. The
  // host loads with the first app, so pages that never show one never download it.
  let app: AppRequest | null = $state(null);
  let AppHost: typeof import('./ui/AppHost.svelte').default | null = $state(null);
  // svelte-ignore state_referenced_locally
  const stopApps = shell.apps.subscribe((request) => {
    const closed = app !== null && request === null;
    app = request;
    if (request !== null && AppHost === null) {
      import('./ui/AppHost.svelte').then(
        (module) => (AppHost = module.default),
        // Its chunk never came: the command gets no result, and the prompt comes back.
        () => shell.closeApp(request.id),
      );
    }
    // Back at the prompt: on a desktop the caret goes back into it.
    if (closed) void tick().then(() => prompt.focus());
  });
  onDestroy(stopApps);

  /** The screen as it is, for the session snapshot. */
  function snapshotSource() {
    return {
      entries: transcript.entries(),
      line: prompt.snapshotLine(),
      cwd: shell.cwd.get(),
      scroll: { top: screen?.scrollTop ?? 0, atBottom: screen === undefined || distanceFromBottom(screen) <= PIN_THRESHOLD_PX },
    };
  }

  /** Saves the snapshot before a tap leaves the page in this view (an in-app browser's links). */
  let beforeLeaving: () => void = () => {};

  /** Puts back the line and where the screen was scrolled to, after Back. */
  function restoreView(snapshot: SessionSnapshot): void {
    // Unless something has been typed since.
    if (snapshot.line !== '' && prompt.text === '') prompt.restoreLine(snapshot.line);
    const place = (): void => {
      if (!screen) return;
      screen.scrollTop = snapshot.scroll.atBottom ? screen.scrollHeight : snapshot.scroll.top;
    };
    // Once the entries are drawn, and again once the layout blocks' chunk has drawn them.
    void tick().then(() => win?.requestAnimationFrame(place));
    win?.setTimeout(place, 300);
  }

  onMount(() => {
    void restored?.then((snapshot) => snapshot !== null && restoreView(snapshot));
    // Only an app's history entry carries a state (ui/apps/history-entry.ts). A page reloaded,
    // or reached by Back, while an app was open starts on that entry, which no app holds now:
    // it comes off, or the visitor's next Back would seem to do nothing.
    if (win !== undefined && win.history.state != null) void import('./ui/apps/history-entry').then(({ dropStrayEntry }) => dropStrayEntry(), () => {});
    if (win === undefined || session === null) return;
    // Saving loads in its own chunk just after the first paint, as the status line does: before
    // then nothing on the screen is worth putting back.
    let saver: typeof import('./services/session-save') | null = null;
    import('./services/session-save').then(
      (module) => (saver = module),
      () => {},
    );
    // Put away (a link opened in the same view, the app switched): the screen goes to the
    // snapshot, for Back. A page kept whole in the back/forward cache needs none of it, unless it
    // came back without its state. WebKit loses what pagehide writes when the next page is on
    // another site, so a tap on a link that opens in this view saves first, as hiding the page does.
    const save = (): void => void saver?.saveSnapshot(session, snapshotSource(), Date.now());
    const onPageHide = save;
    const onLinkTap = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      // An in-app browser may open even a new-tab link in this view.
      if (link !== null && (opener?.inApp != null || link.getAttribute('target') !== '_blank')) save();
    };
    const onVisibility = (): void => {
      if (win.document.visibilityState === 'hidden') save();
    };
    beforeLeaving = save;
    const onPageShow = (event: PageTransitionEvent): void => {
      if (!event.persisted || transcript.entries().length > 0) return;
      void import('./services/session-restore').then(({ reviveSnapshot }) => {
        const snapshot = reviveSnapshot(session.get(SNAPSHOT_KEY), Date.now());
        if (snapshot === null || snapshot.entries.length === 0 || transcript.entries().length > 0) return;
        transcript.replace(snapshot.entries.map((entry) => ({ ...entry, origin: 'boot' as const })));
        if (snapshot.cwd !== '') shell.restoreCwd(snapshot.cwd);
        restoreView(snapshot);
      });
    };
    win.addEventListener('pagehide', onPageHide);
    win.addEventListener('pageshow', onPageShow);
    win.document.addEventListener('click', onLinkTap, true);
    win.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      beforeLeaving = () => {};
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
      win.document.removeEventListener('click', onLinkTap, true);
      win.document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  /** A tap on a trusted action in the output: a did-you-mean, a chip, a link card. */
  function onaction(action: Action): void {
    switch (action.kind) {
      case 'run':
        prompt.submit(action.line, 'chip');
        prompt.focus();
        break;
      case 'insert':
        // The text is at the prompt to be finished: bring the prompt into view, and on a phone
        // open the keyboard now, inside the tap, with the text ready.
        prompt.insert(action.text);
        prompt.focus({ keyboard: true });
        if (screen) scrollToEnd(screen);
        break;
      case 'open':
        // A new tab, or the same view inside an in-app browser. Only the opener opens anything
        // (02, section 7): with none, as in a test mount, the bell says nothing happened.
        if (opener) {
          if (opener.plan(action.href).target === '_self') beforeLeaving();
          opener.open(action.href);
        } else prompt.ringBell();
        break;
      case 'copy':
        void clipboard.copy(action.text).then((copied) => {
          if (!copied) prompt.ringBell();
        });
        break;
      case 'share':
        if (opener) void opener.share({ url: action.url, ...(action.title ? { title: action.title } : {}) });
        else prompt.ringBell();
        break;
    }
  }
</script>

<div class="shell" class:has-dock={dock && !dockFailed} inert={app !== null} use:focusPolicy={{ input: () => prompt.element }}>
  <div class="screen-frame">
    <main
      bind:this={screen}
      class="screen"
      use:stickToBottom={{ content: '.scrollback', entries: '[role="log"]', onpill: (visible) => (newOutput = visible) }}
    >
      <div class="scrollback">
        <h1 class="sr-only">Vesen terminal</h1>

        <!-- Announced politely as entries are added; held back while a command is still running. -->
        <div role="log" aria-live="polite" aria-relevant="additions" aria-busy={prompt.running !== null} aria-label="Terminal output">
          <Transcript {onaction} status={statusLine} />
        </div>

        <div class="prompt-area" data-prompt-area>
          {#if !runningEntry}
            {@render statusLine()}
          {/if}
          <PromptLine controller={prompt} {shell} />

          <!-- Tab's list, the chips while typing, and the starters on an empty phone prompt. -->
          {#if CompletionRow}
            <CompletionRow
              chips={inlineChips}
              more={Dock === null ? prompt.chipList.more : 0}
              listed={prompt.listed}
              question={prompt.question}
              announce={prompt.announce}
              onchoose={(chip) => prompt.choose(chip)}
            />
          {/if}
        </div>
      </div>

      <!-- The empty space under the prompt: tapping it opens the keyboard. -->
      <div class="tap-to-type" data-prompt-area aria-hidden="true"></div>
    </main>

    {#if newOutput}
      <button
        type="button"
        class="new-output"
        aria-label="Scroll to new output"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => screen && scrollToEnd(screen)}
      >↓ New output</button>
    {/if}

    <Cathode />
  </div>

  <!-- The phone dock (docs/plan/04-phone-and-instagram.md): chips, keys and the history sheet. -->
  <div class="dock-slot" class:pending={dock && Dock === null && !dockFailed}>
    {#if Dock}<Dock controller={prompt} />{/if}
  </div>
</div>

<!-- What a running line is doing, for how long, and how to stop it (F013, F047). -->
{#snippet statusLine()}
  {#if prompt.status && StatusLine}
    <StatusLine label={prompt.status.label} startedAt={prompt.status.startedAt} touch={prompt.touch} onstop={() => prompt.interrupt()} />
  {/if}
{/snippet}

<!-- Outside <main>, whose vintage CRT filter would capture it, and over the dock too. A host of its
     own for each app, so each has its own history entry. -->
{#if app && AppHost}
  {#key app.id}
    <AppHost request={app} onclose={(id, result) => shell.closeApp(id, result)} />
  {/key}
{/if}

<style>
  /* The dock's room, kept while its chunk loads: the chip row over the closed bar. */
  .dock-slot.pending {
    min-height: calc(93px + env(safe-area-inset-bottom));
  }

  .new-output {
    position: absolute;
    z-index: 3;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 12px;
    border: 1px solid var(--role-accent);
    border-radius: 999px;
    background: var(--theme-background);
    color: var(--role-accent);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  @media (pointer: coarse) {
    .new-output {
      min-height: 44px;
      padding-inline: 16px;
    }
  }

  .new-output:active {
    background: var(--role-accent);
    color: var(--theme-background);
  }
</style>
