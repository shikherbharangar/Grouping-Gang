// Real Chromium layout measurements of the built UI with the runner's API double.
// A small page viewport models popup bootstrap, NOT the native extension host.
// Native action-popup auto-sizing still needs verification in an unrestricted browser.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function geometry(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const e = document.querySelector(selector);
      const b = e.getBoundingClientRect();
      const css = getComputedStyle(e);
      return {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        minWidth: css.minWidth,
        boxSizing: css.boxSizing,
        clientWidth: e.clientWidth,
        scrollWidth: e.scrollWidth,
        clientHeight: e.clientHeight,
        scrollHeight: e.scrollHeight,
        overflowY: css.overflowY,
      };
    };
    return {
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
      root: box('html'),
      body: box('body'),
      app: box('.switcher'),
      search: box('#search'),
      list: box('#slots'),
      footer: box('footer'),
    };
  });
}
function assertAnchored(g) {
  for (const key of ['root', 'body', 'app']) {
    assert.ok(
      parseFloat(g[key].minWidth) >= 520,
      `${key} needs an explicit 520px minimum; got ${g[key].minWidth}`,
    );
    assert.ok(
      g[key].width >= 520 && g[key].width <= 600,
      `${key} collapsed or exceeded popup width: ${g[key].width}`,
    );
    assert.equal(g[key].boxSizing, 'border-box');
    // html.clientWidth is the host viewport, which has not expanded at bootstrap.
    const usableWidth =
      key === 'root' ? Math.max(g[key].clientWidth, g[key].width) : g[key].clientWidth;
    assert.ok(g[key].scrollWidth <= usableWidth + 1, `${key} has internal horizontal overflow`);
  }
  if (g.viewport.width < 520)
    assert.equal(
      g.root.width,
      560,
      'popup document requests 560px independently of initial viewport',
    );
  assert.ok(g.search.width >= 380, `search field collapsed: ${g.search.width}`);
}
async function assertFits(page) {
  const g = await geometry(page);
  assertAnchored(g);
  assert.ok(
    g.root.scrollWidth <= g.root.clientWidth + 1,
    `unexpected document horizontal scrolling: ${JSON.stringify(g)}`,
  );
  assert.ok(g.root.height <= 600, 'document exceeds Chromium popup height limit');
  return g;
}
export async function checkPopupGeometry(browser, origin, artifacts, pass) {
  const page = await browser.newPage();
  const report = {};
  try {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    // This MUST precede navigation. Giving the page 560px first hid the V1.1 bug.
    await page.setViewportSize({ width: 40, height: 600 });
    await page.goto(`${origin}/src/switcher/index.html`);
    await page.locator('.slot[data-slot]').last().waitFor();
    report.narrowBootstrap = await geometry(page);
    assertAnchored(report.narrowBootstrap);
    assert.ok(report.narrowBootstrap.list.width >= 480, 'results list collapsed during bootstrap');
    pass('40px initial viewport cannot collapse the document, launcher, search or list');
    // A normal page cannot resize its host viewport. Model the native host accepting
    // the requested document width, then check that the contents fit without clipping.
    await page.setViewportSize({ width: 560, height: 600 });
    report.normal = await assertFits(page);
    assert.ok(
      report.normal.list.scrollHeight <= report.normal.list.clientHeight,
      'five rows need no list scrollbar',
    );
    await page.evaluate(() => {
      const original = globalThis.__gg.state.destinations;
      globalThis.__gg.state.destinations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((slot, index) => ({
        ...original[index % original.length],
        id: `geometry-${slot}`,
        slot,
        title: `Destination ${slot} — a long name that must retain a readable title column`,
      }));
      globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
    });
    await page.waitForFunction(() => document.querySelectorAll('.slot[data-slot]').length === 10);
    report.tenSlots = await assertFits(page);
    assert.ok(report.tenSlots.list.width >= 480);
    assert.ok(
      report.tenSlots.list.scrollHeight > report.tenSlots.list.clientHeight,
      'ten rows should scroll vertically',
    );
    assert.equal(report.tenSlots.list.overflowY, 'auto');
    const rows = await page.locator('.slot').evaluateAll((elements) =>
      elements.map((row) => {
        const rect = (selector) => row.querySelector(selector).getBoundingClientRect();
        return {
          width: row.clientWidth,
          scrollWidth: row.scrollWidth,
          numberX: rect('.number').x,
          numberWidth: rect('.number').width,
          titleWidth: rect('.slot-title').width,
          statusWidth: rect('.slot-state').width,
          fullTitle: row.title,
          text: row.querySelector('.slot-title').textContent,
        };
      }),
    );
    for (const row of rows) {
      assert.equal(row.numberWidth, 28, 'number column cannot shrink');
      assert.equal(row.numberX, rows[0].numberX);
      assert.ok(row.titleWidth >= 240, `title column became unreadable: ${row.titleWidth}`);
      assert.ok(row.scrollWidth <= row.width + 1);
      assert.equal(row.fullTitle, row.text);
    }
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        animations: 'disabled',
        path: resolve(artifacts, `popup-ten-slots-${theme}.png`),
      });
    }
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-slot="0"]').getBoundingClientRect().bottom <=
        document.querySelector('#slots').getBoundingClientRect().bottom + 1,
    );
    pass(
      'ten long destinations retain aligned numbers, readable titles and vertical keyboard scrolling',
    );
    // Restore the fixture and use its pinned-tab failure for the real error UI.
    await page.reload();
    await page.locator('.slot[data-slot]').last().waitFor();
    await page.evaluate(() => {
      globalThis.__gg.failMove = true;
    });
    await page.locator('#search').press('1');
    await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    await page.evaluate(() => {
      const now = Date.now();
      globalThis.__gg.state.undo = { id: 'geometry-undo', expiresAt: now + 30000 };
      globalThis.__gg.state.assignmentUndo = { id: 'geometry-assignment', expiresAt: now + 30000 };
      globalThis.__gg.state.notice = {
        id: 'geometry-undo',
        kind: 'move',
        message: 'Moved to ' + 'VeryLongDestination'.repeat(12),
        expiresAt: now + 5000,
      };
      globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
    });
    await page.locator('#undo-assignment').waitFor();
    report.errorAndUndo = await assertFits(page);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        animations: 'disabled',
        path: resolve(artifacts, `popup-geometry-${theme}.png`),
        fullPage: true,
      });
    }
    const controls = await page.locator('footer > *, #notice button').evaluateAll((elements) =>
      elements
        .filter((e) => e.getClientRects().length)
        .map((e) => ({
          left: e.getBoundingClientRect().left,
          right: e.getBoundingClientRect().right,
        })),
    );
    for (const b of controls) {
      assert.ok(b.left >= 0);
      assert.ok(b.right <= report.errorAndUndo.body.width);
    }
    pass('error, long notice and every footer/Undo control fit in both themes');
    await page.setViewportSize({ width: 560, height: 300 });
    report.shortViewport = await assertFits(page);
    await page.locator('#settings').scrollIntoViewIfNeeded();
    const settings = await page.locator('#settings').boundingBox();
    assert.ok(
      settings.y >= 0 && settings.y + settings.height <= 300,
      'short popup can scroll to its action controls',
    );
    await page.screenshot({
      animations: 'disabled',
      path: resolve(artifacts, 'popup-geometry-short.png'),
    });
    pass('short available height scrolls to actions without horizontal overflow');
    await page.setViewportSize({ width: 40, height: 600 });
    await page.goto(`${origin}/src/switcher/index.html?fresh=1`);
    await page.locator('#accept-setup').waitFor();
    report.setupBootstrap = await geometry(page);
    assertAnchored(report.setupBootstrap);
    await page.setViewportSize({ width: 560, height: 600 });
    report.setup = await assertFits(page);
    assert.ok(
      await page.locator('#proposal-1').evaluate((e) => e.getBoundingClientRect().width >= 400),
    );
    await page.locator('#accept-setup').scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      path: resolve(artifacts, 'popup-geometry-setup.png'),
    });
    pass('onboarding keeps its full width and accessible confirmation control');
    await page.goto(`${origin}/src/switcher/index.html?hold-state=1`);
    await page.waitForFunction(() => typeof globalThis.__gg.releaseState === 'function');
    await page.locator('#search').waitFor();
    report.loading = await assertFits(page);
    await page.screenshot({
      animations: 'disabled',
      path: resolve(artifacts, 'popup-geometry-loading.png'),
    });
    await page.evaluate(() => globalThis.__gg.releaseState());
    await page.locator('.slot[data-slot]').last().waitFor();
    await page.evaluate(() => {
      globalThis.__gg.state.destinations = [];
      globalThis.__gg.onMessage({ type: 'invalidated' }, { id: 'ui-test-only' }, () => {});
    });
    await page.locator('#empty').waitFor();
    report.empty = await assertFits(page);
    await page.screenshot({
      animations: 'disabled',
      path: resolve(artifacts, 'popup-geometry-empty.png'),
    });
    await page.evaluate(() => {
      document.querySelector('#status').textContent = 'Recreating destination…';
    });
    report.recoveryProgress = await assertFits(page);
    pass('loading, empty and recovery-progress shells preserve popup geometry');
    await writeFile(
      resolve(artifacts, 'popup-geometry.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  } finally {
    await page.close();
  }
}
