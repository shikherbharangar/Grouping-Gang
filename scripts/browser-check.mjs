// Browser-rendered UI checks with a deliberately isolated Chrome API test double.
// These verify the shipped DOM/CSS/event handlers, not real extension API behavior.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root = resolve('dist');
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/')) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const profile = await mkdtemp(resolve(tmpdir(), 'grouping-gang-ui-'));
let browser;
let checks = 0;
function pass(name) {
  checks++;
  console.log(`PASS ${name}`);
}
try {
  browser = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    args: ['--no-sandbox'],
    viewport: { width: 1200, height: 1100 },
  });
  const errors = [];
  browser.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await browser.addInitScript(() => {
    const changes = [];
    const groups = [
      {
        id: 10,
        windowId: 1,
        title: 'Field notes',
        color: 'green',
        collapsed: false,
        tabIds: [100],
        firstIndex: 0,
      },
      {
        id: 11,
        windowId: 1,
        title: 'Things worth keeping',
        color: 'yellow',
        collapsed: true,
        tabIds: [101],
        firstIndex: 2,
      },
      {
        id: 12,
        windowId: 2,
        title: 'The next big little idea — a very long group name that should truncate cleanly',
        color: 'blue',
        collapsed: false,
        tabIds: [102],
        firstIndex: 0,
      },
      {
        id: 13,
        windowId: 2,
        title: 'Reading room',
        color: 'purple',
        collapsed: false,
        tabIds: [103],
        firstIndex: 2,
      },
    ];
    const titles = [
      'Field notes',
      'Things worth keeping',
      'The next big little idea — a very long group name that should truncate cleanly',
      'Weekend plans',
      'Reading room',
    ];
    const destinations = titles.map((title, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      slot: i + 1,
      title,
      color: ['green', 'yellow', 'blue', 'orange', 'purple'][i],
      state: i === 3 ? 'missing' : i === 4 ? 'ambiguous' : 'live',
      group: i < 3 ? groups[i] : null,
      candidates: i === 4 ? [13] : [],
      interrupted: false,
      binding: null,
      lastSeenAt: 1,
    }));
    const state = {
      destinations,
      groups,
      theme: 'system',
      context: { tabId: 5, windowId: 1 },
      tabTitle: 'A good place to start — current tab',
      shortcut: '⌘⇧.',
      version: '1.1.0',
      setupCompleted: true,
      autoAssign: false,
      undo: null,
      notice: null,
    };
    const fresh = new URL(location.href).searchParams.has('fresh');
    const slow = new URL(location.href).searchParams.has('slow');
    if (fresh) {
      state.setupCompleted = false;
      state.destinations = [];
    }
    globalThis.__gg = { state, commands: [], closed: false, failMove: false, options: false };
    const emit = () =>
      changes.forEach((fn) => fn({ registry: { newValue: { theme: state.theme } } }, 'local'));
    globalThis.close = () => {
      globalThis.__gg.closed = true;
    };
    globalThis.chrome = {
      storage: {
        local: {
          get: async () => ({
            registry: {
              version: 3,
              theme: state.theme,
              destinations: state.destinations.map((d) => ({
                id: d.id,
                slot: d.slot,
                title: d.title,
                color: d.color,
                lastSeenAt: d.lastSeenAt,
                binding: d.binding,
              })),
              pending: null,
              setupCompleted: state.setupCompleted,
              autoAssign: state.autoAssign,
            },
          }),
        },
        onChanged: { addListener: (fn) => changes.push(fn) },
      },
      tabs: { create: async () => ({}) },
      runtime: {
        id: 'ui-test-only',
        onMessage: {
          addListener: (fn) => {
            globalThis.__gg.onMessage = fn;
          },
        },
        openOptionsPage: async () => {
          globalThis.__gg.options = true;
        },
        sendMessage: async (command) => {
          globalThis.__gg.commands.push(command);
          if (command.type === 'state') {
            if (slow) await new Promise((resolve) => setTimeout(resolve, 180));
            return { ok: true, state: structuredClone(state) };
          }
          if (command.type === 'setup') {
            state.setupCompleted = true;
            state.autoAssign = command.autoAssign;
            state.destinations = command.assignments.map((a) => {
              const g = groups.find((g) => g.id === a.groupId);
              return {
                ...destinations[0],
                id: `setup-${a.slot}`,
                slot: a.slot,
                title: g.title,
                color: g.color,
                group: g,
                state: 'live',
              };
            });
            emit();
            return { ok: true, state: structuredClone(state) };
          }
          if (command.type === 'auto-assign') {
            state.autoAssign = command.enabled;
            emit();
            return { ok: true };
          }
          if (command.type === 'undo') {
            state.undo = null;
            state.notice = null;
            return { ok: true, outcome: 'Move undone.' };
          }
          if (command.type === 'undo-assignment' || command.type === 'dismiss-notice') {
            state.notice = null;
            if (command.type === 'undo-assignment') state.assignmentUndo = null;
            return { ok: true };
          }
          if (command.type === 'move')
            return globalThis.__gg.failMove
              ? {
                  ok: false,
                  code: 'PINNED',
                  message: 'Pinned tabs stay pinned. Unpin this tab yourself before moving it.',
                }
              : { ok: true };
          if (command.type === 'theme') {
            state.theme = command.theme;
            emit();
            return { ok: true };
          }
          if (command.type === 'sessions')
            return {
              ok: true,
              sessions: [
                { sessionId: 'closed-tab-1', title: 'A previously closed page', lastModified: 1 },
              ],
            };
          if (command.type === 'recover')
            return { ok: true, outcome: 'Destination recreated. Previous tabs were not restored.' };
          if (command.type === 'assign') {
            const g = groups.find((g) => g.id === command.groupId);
            state.destinations = state.destinations.filter((d) => d.slot !== command.slot);
            state.destinations.push({
              ...destinations[0],
              slot: command.slot,
              id: `new-${command.slot}`,
              title: g.title,
              color: g.color,
              group: g,
              state: 'live',
            });
            emit();
          }
          if (command.type === 'forget') {
            state.destinations = state.destinations.filter((d) => d.slot !== command.slot);
            emit();
          }
          if (command.type === 'transfer') {
            state.destinations.forEach((d) => {
              if (d.slot === command.from) d.slot = command.to;
              else if (d.slot === command.to) d.slot = command.from;
            });
            emit();
          }
          if (command.type === 'reset') {
            state.destinations = [];
            state.theme = 'system';
            emit();
          }
          return { ok: true, state: structuredClone(state) };
        },
      },
    };
  });
  const settings = await browser.newPage();
  await settings.goto(`${origin}/src/settings/index.html`);
  await settings.locator('.assignment').last().waitFor();
  assert.equal(await settings.locator('.assignment').count(), 10);
  pass('settings renders ten actual assignment rows');
  await settings.locator('[data-theme-choice="light"]').click();
  await settings.screenshot({
    animations: 'disabled',
    path: resolve(artifacts, 'settings-light.png'),
    fullPage: true,
  });
  await settings.locator('[data-theme-choice="dark"]').click();
  await settings.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await settings.screenshot({
    animations: 'disabled',
    path: resolve(artifacts, 'settings-dark.png'),
    fullPage: true,
  });
  assert.equal(
    await settings.locator('[data-theme-choice="dark"]').getAttribute('aria-pressed'),
    'true',
  );
  pass('manual appearance changes without reload and sends persistence command');
  await settings.locator('[data-theme-choice="system"]').click();
  await settings.emulateMedia({ colorScheme: 'dark' });
  assert.equal(
    await settings.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'dark',
  );
  await settings.emulateMedia({ colorScheme: 'light' });
  assert.equal(
    await settings.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'light',
  );
  pass('system appearance follows live OS changes');
  await settings.locator('[data-edit="6"]').click();
  await settings.locator('#group').selectOption('13');
  await settings.getByRole('button', { name: 'Assign group', exact: true }).click();
  await settings.waitForFunction(() => !document.querySelector('dialog'));
  assert.match(await settings.locator('.assignment').nth(5).innerText(), /Reading room/);
  pass('assignment dialog submits selected real group ID');
  await settings.locator('[data-edit="1"]').click();
  await settings.locator('#new-slot').selectOption('0');
  await settings.getByRole('button', { name: 'Move number', exact: true }).click();
  await settings.waitForFunction(() => !document.querySelector('dialog'));
  assert.match(await settings.locator('.assignment').last().innerText(), /Field notes/);
  pass('number management submits explicit transfer');
  await settings.locator('[data-edit="0"]').click();
  await settings.getByRole('button', { name: 'Forget this destination…' }).click();
  await settings.evaluate(() => {
    globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
  });
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await settings.locator(':focus').getAttribute('data-edit'), '0');
  assert.match(await settings.locator('.assignment').last().innerText(), /Field notes/);
  pass('destructive cancellation preserves assignment');
  await settings.locator('[data-edit="4"]').click();
  await settings.getByRole('button', { name: 'Recreate or recover…' }).click();
  await settings.locator('#closed-tab').selectOption('closed-tab-1');
  await settings.screenshot({
    animations: 'disabled',
    path: resolve(artifacts, 'recovery-dialog.png'),
  });
  await settings.getByRole('button', { name: 'Recover tab & recreate' }).click();
  await settings.waitForFunction(() => !document.querySelector('dialog'));
  assert.ok(
    await settings.evaluate(() =>
      globalThis.__gg.commands.some((c) => c.type === 'recover' && c.sessionId === 'closed-tab-1'),
    ),
  );
  pass('recovery requires an explicit session selection and confirmation');
  const popup = await browser.newPage();
  await popup.setViewportSize({ width: 560, height: 430 });
  await popup.goto(`${origin}/src/switcher/index.html`);
  await popup.locator('.slot').last().waitFor();
  assert.equal(await popup.locator('.slot[data-slot]').count(), 5);
  pass('launcher renders assigned destinations without ten empty rows');
  await popup.evaluate(() => {
    globalThis.__gg.state.destinations[1].group.collapsed = false;
    globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
  });
  await popup.waitForFunction(
    () => document.querySelector('[data-slot="2"] .slot-state').textContent === '',
  );
  await popup.evaluate(() => {
    globalThis.__gg.state.destinations[1].group.collapsed = true;
    globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
  });
  await popup.waitForFunction(
    () => document.querySelector('[data-slot="2"] .slot-state').textContent === 'Collapsed',
  );
  pass('browser event invalidation refreshes collapsed state without polling');
  assert.ok(await popup.evaluate(() => document.body.scrollHeight <= 430));
  assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= 560));
  pass('compact launcher fits its surface without horizontal overflow');
  await popup.locator('.switcher').screenshot({
    animations: 'disabled',
    path: resolve(artifacts, 'switcher-light.png'),
  });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup
    .locator('.switcher')
    .screenshot({ animations: 'disabled', path: resolve(artifacts, 'switcher-dark.png') });
  assert.ok(
    await popup
      .locator('[data-slot="3"] .slot-title')
      .evaluate((e) => e.scrollWidth > e.clientWidth),
  );
  assert.match(await popup.locator('[data-slot="3"]').getAttribute('title'), /truncate cleanly/);
  pass('long names truncate with full accessible labels and titles');
  await popup.keyboard.press('ArrowUp');
  assert.equal(await popup.locator('#search').getAttribute('aria-activedescendant'), 'slot-5');
  await popup.keyboard.press('ArrowDown');
  assert.equal(await popup.locator('#search').getAttribute('aria-activedescendant'), 'slot-1');
  await popup.keyboard.press('Tab');
  assert.equal(await popup.locator(':focus').getAttribute('id'), 'settings');
  await popup.keyboard.press('Enter');
  assert.ok(await popup.evaluate(() => globalThis.__gg.options));
  pass('arrow wrap, visible focus and Tab/Enter settings navigation');
  await popup.locator('#search').focus();
  await popup.keyboard.press('0');
  assert.match(await popup.locator('#status').innerText(), /Number 0 is unassigned/);
  assert.ok(!(await popup.evaluate(() => globalThis.__gg.commands.some((c) => c.type === 'move'))));
  pass('zero and empty slots never move a tab');
  await popup.keyboard.press('5');
  assert.match(await popup.locator('#status').innerText(), /Confirm the intended group/);
  pass('ambiguous destination requires explicit binding');
  await popup.keyboard.press('Escape');
  assert.equal(await popup.locator('dialog').count(), 0);
  assert.ok(!(await popup.evaluate(() => globalThis.__gg.commands.some((c) => c.type === 'move'))));
  pass('Escape cancels without side effects');
  await popup.reload();
  await popup.locator('.slot[data-slot]').last().waitFor();
  await popup.keyboard.press('4');
  await popup.waitForFunction(() => globalThis.__gg.closed);
  assert.equal(await popup.locator('dialog').count(), 0);
  assert.ok(
    await popup.evaluate(() =>
      globalThis.__gg.commands.some((c) => c.type === 'move' && c.slot === 4),
    ),
  );
  pass('selecting a missing destination invokes direct recreation without confirmation');
  await popup.reload();
  await popup.locator('.slot[data-slot]').last().waitFor();
  await popup.evaluate(() => {
    globalThis.__gg.failMove = true;
  });
  await popup.keyboard.press('1');
  await popup.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('Pinned'),
  );
  assert.ok(!(await popup.evaluate(() => globalThis.__gg.closed)));
  pass('failed operation stays open and explains the failure');
  await popup.evaluate(() => {
    globalThis.__gg.failMove = false;
  });
  await popup.keyboard.press('1');
  await popup.waitForFunction(() => globalThis.__gg.closed);
  assert.deepEqual(
    await popup.evaluate(
      () => globalThis.__gg.commands.filter((c) => c.type === 'move').at(-1).context,
    ),
    { tabId: 5, windowId: 1 },
  );
  pass('numeric move sends the captured tab and closes only after success');
  await popup.reload();
  await popup.locator('.slot').last().waitFor();
  await popup.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await popup.locator('.switcher').evaluate((e) => getComputedStyle(e).animationName),
    'none',
  );
  pass('reduced-motion disables entrance animation');
  await popup.keyboard.press('Escape');
  assert.ok(await popup.evaluate(() => globalThis.__gg.closed));
  assert.ok(!(await popup.evaluate(() => globalThis.__gg.commands.some((c) => c.type === 'move'))));
  pass('Escape dismisses without move');

  await popup.reload();
  await popup.locator('.slot[data-slot]').last().waitFor();
  assert.equal(await popup.locator(':focus').getAttribute('id'), 'search');
  pass('launcher focuses search immediately');
  await popup.locator('#search').fill('field');
  assert.equal(await popup.locator('.slot[data-slot]').count(), 1);
  await popup.keyboard.press('1');
  assert.equal(await popup.locator('#search').inputValue(), 'field1');
  assert.equal(await popup.locator('.slot[data-slot]').count(), 0);
  assert.ok(!(await popup.evaluate(() => globalThis.__gg.commands.some((c) => c.type === 'move'))));
  pass('numbers in a non-empty query are ordinary search input');
  await popup.keyboard.press('Escape');
  assert.equal(await popup.locator('#search').inputValue(), '');
  assert.ok(!(await popup.evaluate(() => globalThis.__gg.closed)));
  pass('first Escape clears search without closing');
  await popup.locator('#search').fill('things');
  assert.equal(await popup.locator('#search').getAttribute('aria-activedescendant'), 'slot-2');
  await popup.locator('#search').fill('field');
  assert.equal(await popup.locator('#search').getAttribute('aria-activedescendant'), 'slot-1');
  pass('selection always references a remaining filtered destination');
  await popup.evaluate(() => {
    const input = document.querySelector('#search');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }),
    );
  });
  await popup.waitForFunction(() => globalThis.__gg.closed);
  assert.equal(
    await popup.evaluate(() => globalThis.__gg.commands.filter((c) => c.type === 'move').length),
    1,
  );
  pass('rapid Enter and key repeat cannot double-activate');
  await popup.goto(`${origin}/src/switcher/index.html?slow=1`);
  await popup.locator('#search').press('1');
  await popup.waitForFunction(() => globalThis.__gg.closed);
  assert.ok(
    await popup.evaluate(() =>
      globalThis.__gg.commands.some((c) => c.type === 'move' && c.slot === 1),
    ),
  );
  pass('number input is accepted while state loads');
  await popup.goto(`${origin}/src/switcher/index.html?fresh=1`);
  await popup.locator('#accept-setup').waitFor();
  assert.equal(await popup.locator('.proposal-row').count(), 10);
  assert.equal(await popup.locator('#proposal-1').inputValue(), '10');
  await popup
    .locator('.switcher')
    .screenshot({ animations: 'disabled', path: resolve(artifacts, 'setup-v1.1.png') });
  await popup.locator('#proposal-1').selectOption('11');
  assert.equal(await popup.locator('#proposal-2').inputValue(), '10');
  await popup.locator('#proposal-1').selectOption('');
  await popup.locator('#accept-setup').click();
  await popup.waitForFunction(() => document.querySelector('#setup').hidden);
  assert.ok(
    await popup.evaluate(() =>
      globalThis.__gg.commands.some((c) => c.type === 'setup' && c.assignments.length === 3),
    ),
  );
  pass('first-use mapping can be edited and accepted in one action');
  await popup.goto(`${origin}/src/switcher/index.html`);
  await popup.locator('.slot[data-slot]').last().waitFor();
  await popup.evaluate(() => {
    const now = Date.now();
    globalThis.__gg.state.undo = { id: 'last-move', expiresAt: now + 10000 };
    globalThis.__gg.state.notice = {
      id: 'last-move',
      kind: 'move',
      message: 'Moved to Field notes.',
      expiresAt: now + 1000,
    };
    globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
  });
  await popup.locator('#notice-undo').waitFor();
  await popup
    .locator('.switcher')
    .screenshot({ animations: 'disabled', path: resolve(artifacts, 'undo-v1.1.png') });
  await popup.locator('#notice-undo').click();
  await popup.waitForFunction(() =>
    globalThis.__gg.commands.some((c) => c.type === 'undo' && c.id === 'last-move'),
  );
  pass('visible Undo sends the exact short-lived operation ID');
  await popup.evaluate(() => {
    globalThis.__gg.state.notice = {
      id: 'auto',
      kind: 'assignment',
      message: 'Assigned Reading room to 6.',
      expiresAt: Date.now() + 500,
    };
    globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
  });
  await popup.locator('#notice').waitFor();
  await popup.waitForFunction(() => document.querySelector('#notice').hidden);
  pass('temporary notification expires without blocking input');
  await popup.evaluate(() => {
    globalThis.__gg.state.assignmentUndo = { id: 'assignment-undo', expiresAt: Date.now() + 10000 };
    globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
  });
  await popup.locator('#undo-assignment').waitFor();
  await popup.locator('#undo-assignment').click();
  await popup.waitForFunction(() =>
    globalThis.__gg.commands.some(
      (c) => c.type === 'undo-assignment' && c.id === 'assignment-undo',
    ),
  );
  pass('automatic assignment undo remains reachable after the banner expires');
  await popup.evaluate(() => {
    const d = {
      ...globalThis.__gg.state.destinations[0],
      id: 'zero',
      slot: 0,
      title: 'Zero destination',
    };
    globalThis.__gg.state.destinations.push(d);
    globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
  });
  await popup.locator('[data-slot="0"]').waitFor();
  await popup.locator('#search').focus();
  await popup.keyboard.press('0');
  await popup.waitForFunction(() => globalThis.__gg.closed);
  assert.ok(
    await popup.evaluate(() =>
      globalThis.__gg.commands.some((c) => c.type === 'move' && c.slot === 0),
    ),
  );
  pass('assigned number zero invokes the tenth slot');
  await settings.locator('#auto-assign').check();
  assert.ok(
    await settings.evaluate(() =>
      globalThis.__gg.commands.some((c) => c.type === 'auto-assign' && c.enabled),
    ),
  );
  pass('automatic assignment preference is configurable');

  await settings.getByText('Reset & diagnostics', { exact: true }).click();
  await settings.getByRole('button', { name: 'Reset Grouping Gang…' }).click();
  await settings.getByRole('button', { name: 'Reset assignments', exact: true }).click();
  await settings.waitForFunction(() => !document.querySelector('dialog'));
  assert.equal(await settings.locator('.assignment.empty').count(), 10);
  pass('explicit reset renders honest empty state');
  await settings.screenshot({
    animations: 'disabled',
    path: resolve(artifacts, 'settings-empty.png'),
    fullPage: true,
  });
  await settings.setViewportSize({ width: 390, height: 844 });
  assert.ok(await settings.evaluate(() => document.documentElement.scrollWidth <= 390));
  pass('settings reflows without horizontal overflow');
  assert.deepEqual(errors, []);
  pass('no uncaught page errors');
  console.log(
    `\n${checks} browser-rendered UI checks passed. Chrome APIs are mocked; these are not real Brave extension tests.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
