import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/application/engine';
import { emptyRegistry } from '../../src/storage/schema';
import { FakeBrowser, MemoryRepository, destination, group, registry, ID } from '../fixtures';
import type { Result } from '../../src/shared/types';
let repo: MemoryRepository;
let browser: FakeBrowser;
let engine: Engine;
let now: number;
const context = { tabId: 5, windowId: 1 };
beforeEach(() => {
  repo = new MemoryRepository();
  browser = new FakeBrowser();
  now = 100;
  engine = new Engine(repo, browser, () => now);
});
function successful(result: Result): asserts result is Extract<Result, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
}
describe('one-action setup and automatic new groups', () => {
  it('accepts proposed numbers once and preserves them across worker/session restarts', async () => {
    repo.data = emptyRegistry();
    await engine.dispatch({ type: 'state', capture: true });
    successful(
      await engine.dispatch({
        type: 'setup',
        assignments: [{ slot: 0, groupId: 10 }],
        autoAssign: true,
      }),
    );
    const saved = await repo.load();
    expect(saved.destinations[0]?.slot).toBe(0);
    engine = new Engine(repo, browser, () => now);
    expect(await engine.dispatch({ type: 'state' })).toMatchObject({
      ok: true,
      state: { setupCompleted: true },
    });
    expect((await repo.load()).destinations).toEqual(saved.destinations);
    expect(
      await engine.dispatch({ type: 'setup', assignments: [], autoAssign: true }),
    ).toMatchObject({ ok: false, code: 'SETUP' });
  });
  it('allows setup with no groups and assigns the next newly created group', async () => {
    browser.live = [];
    repo.data = emptyRegistry();
    await engine.dispatch({ type: 'state' });
    successful(await engine.dispatch({ type: 'setup', assignments: [], autoAssign: true }));
    browser.live = [group()];
    await engine.reconcileEvent();
    expect((await repo.load()).destinations[0]?.slot).toBe(1);
  });
  it('rejects stale or conflicting setup atomically', async () => {
    repo.data = emptyRegistry();
    expect(
      await engine.dispatch({
        type: 'setup',
        assignments: [{ slot: 1, groupId: 99 }],
        autoAssign: true,
      }),
    ).toMatchObject({ ok: false, code: 'SETUP' });
    expect((await repo.load()).destinations).toHaveLength(0);
  });
  it('assigns only the next free slot and does not renumber existing or missing destinations', async () => {
    repo.data = { ...registry(), setupCompleted: true, autoAssign: true };
    await engine.dispatch({ type: 'state' });
    browser.live = [{ ...group(20), title: 'New group' }];
    await engine.reconcileEvent(10);
    const saved = await repo.load();
    expect(saved.destinations.find((d) => d.id === ID)?.slot).toBe(1);
    expect(saved.destinations.find((d) => d.binding?.groupId === 20)?.slot).toBe(2);
    expect(await engine.latestNotice()).toMatchObject({ kind: 'assignment' });
  });
  it('does not auto-bind a plausible returning group to a new number', async () => {
    repo.data = { ...registry(), setupCompleted: true, autoAssign: true };
    await engine.dispatch({ type: 'state' });
    browser.live = [];
    await engine.reconcileEvent(10);
    browser.live = [group(99)];
    await engine.reconcileEvent();
    expect((await repo.load()).destinations).toHaveLength(1);
    expect(await engine.dispatch({ type: 'state' })).toMatchObject({
      ok: true,
      state: { destinations: [{ state: 'ambiguous' }] },
    });
  });
  it('disabled auto assignment and full registries never overwrite slots', async () => {
    repo.data = { ...registry(), setupCompleted: true, autoAssign: false };
    await engine.dispatch({ type: 'state' });
    browser.live.push({ ...group(20), title: 'Other' });
    await engine.reconcileEvent();
    expect((await repo.load()).destinations).toHaveLength(1);
    const r = await repo.load();
    r.autoAssign = true;
    r.destinations = Array.from({ length: 10 }, (_, i) => ({
      ...destination(),
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      slot: i as 0,
      binding: null,
    }));
    repo.data = r;
    browser.live.push({ ...group(30), title: 'Newer' });
    await engine.reconcileEvent();
    expect((await repo.load()).destinations).toEqual(r.destinations);
  });
  it('undoes automatic assignment once without assigning the same group again', async () => {
    repo.data = { ...registry(), setupCompleted: true, autoAssign: true };
    await engine.dispatch({ type: 'state' });
    browser.live.push({ ...group(20), title: 'Other' });
    await engine.reconcileEvent();
    const notice = await engine.latestNotice();
    expect(notice).not.toBeNull();
    successful(await engine.dispatch({ type: 'undo-assignment', id: notice!.id }));
    await engine.reconcileEvent();
    expect((await repo.load()).destinations).toHaveLength(1);
    expect(await engine.dispatch({ type: 'undo-assignment', id: notice!.id })).toMatchObject({
      ok: false,
      code: 'UNDO_EXPIRED',
    });
  });
  it('will not undo an assignment whose number was edited', async () => {
    repo.data = { ...registry(), setupCompleted: true, autoAssign: true };
    await engine.dispatch({ type: 'state' });
    browser.live.push({ ...group(20), title: 'Other' });
    await engine.reconcileEvent();
    const n = await engine.latestNotice();
    await engine.dispatch({ type: 'transfer', from: 2, to: 3 });
    expect(await engine.dispatch({ type: 'undo-assignment', id: n!.id })).toMatchObject({
      ok: false,
      code: 'UNDO_CHANGED',
    });
  });
  it('reconciliation remains idempotent with auto assignment and duplicate events', async () => {
    repo.data = { ...registry(), setupCompleted: true, autoAssign: true };
    await engine.dispatch({ type: 'state' });
    browser.live.push({ ...group(20), title: 'Other' });
    await engine.reconcileEvent();
    const before = await repo.load();
    const writes = repo.writes;
    await Promise.all([engine.reconcileEvent(), engine.reconcileEvent()]);
    expect(await repo.load()).toEqual(before);
    expect(repo.writes).toBe(writes);
  });
  it('only groups created after enabling automatic assignment receive numbers', async () => {
    await engine.dispatch({ type: 'state' });
    browser.live.push({ ...group(20), title: 'Old unassigned' });
    await engine.dispatch({ type: 'auto-assign', enabled: true });
    expect((await repo.load()).destinations).toHaveLength(1);
  });
});
describe('source and direct missing movement', () => {
  it('uses a pre-open handoff instead of querying a different active tab', async () => {
    const result = await engine.dispatch(
      { type: 'state', capture: true },
      { tabId: 44, windowId: 2, title: 'Captured page' },
    );
    expect(result).toMatchObject({
      ok: true,
      state: { context: { tabId: 44, windowId: 2 }, tabTitle: 'Captured page' },
    });
  });
  it('automatically recreates a missing destination on deliberate move selection', async () => {
    browser.live = [];
    const result = await engine.dispatch({ type: 'move', slot: 1, context });
    successful(result);
    expect(result.notice?.message).toContain('Previous tabs were not restored');
    expect(browser.createTab).not.toHaveBeenCalled();
    expect(browser.restoreTab).not.toHaveBeenCalled();
    expect(browser.live).toHaveLength(1);
    expect((await repo.load()).destinations[0]?.id).toBe(ID);
  });
  it('serializes rapid duplicate selections without creating a second group', async () => {
    browser.live = [];
    const results = await Promise.all([
      engine.dispatch({ type: 'move', slot: 1, context }),
      engine.dispatch({ type: 'move', slot: 1, context }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(browser.live).toHaveLength(1);
    expect(browser.group).toHaveBeenCalledTimes(1);
  });
  it('reports a closed source rather than substituting another tab', async () => {
    browser.tabs = [];
    expect(await engine.dispatch({ type: 'move', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'STALE_TAB',
    });
    expect(browser.group).not.toHaveBeenCalled();
  });
});
describe('one short-lived move undo', () => {
  async function move() {
    const result = await engine.dispatch({ type: 'move', slot: 1, context });
    successful(result);
    expect(result.notice).toBeDefined();
    return result.notice!.id;
  }
  it('returns an ungrouped tab to its original position without closing any tabs', async () => {
    const id = await move();
    successful(await engine.dispatch({ type: 'undo', id }));
    expect(browser.tabs[0]).toMatchObject({ windowId: 1, groupId: -1, index: 4 });
    expect(browser.ungroup).toHaveBeenCalledWith(5);
    expect(browser.tabs).toHaveLength(1);
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_EXPIRED',
    });
  });
  it('returns to an existing original group and keeps unrelated destination tabs', async () => {
    browser.tabs[0]!.groupId = 30;
    browser.live.push({ ...group(30), title: 'Original', tabIds: [5, 130] });
    const id = await move();
    successful(await engine.dispatch({ type: 'undo', id }));
    expect(browser.tabs[0]?.groupId).toBe(30);
    expect(browser.live.find((g) => g.id === 10)?.tabIds).toContain(110);
  });
  it('restores an original window for a cross-window move', async () => {
    browser.live[0]!.windowId = 2;
    const id = await move();
    successful(await engine.dispatch({ type: 'undo', id }));
    expect(browser.tabs[0]).toMatchObject({ windowId: 1, groupId: -1, index: 4 });
    expect(browser.activate).toHaveBeenLastCalledWith(5, 1);
  });
  it('survives worker restart in the same session but not browser session changes', async () => {
    const id = await move();
    engine = new Engine(repo, browser, () => now);
    successful(await engine.dispatch({ type: 'undo', id }));
    const result = await engine.dispatch({ type: 'move', slot: 1, context });
    successful(result);
    browser.sessionEpoch = 'other';
    expect(await engine.dispatch({ type: 'undo', id: result.notice!.id })).toMatchObject({
      ok: false,
      code: 'UNDO_EXPIRED',
    });
  });
  it('expires without retaining a persistent move history', async () => {
    const id = await move();
    expect(await repo.load()).not.toHaveProperty('lastMove');
    now += 30001;
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_EXPIRED',
    });
  });
  it('refuses undo if the tab was pinned, closed, or externally moved', async () => {
    const id = await move();
    browser.tabs[0]!.pinned = true;
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_CHANGED',
    });
    browser.tabs[0]!.pinned = false;
    browser.tabs[0]!.groupId = 99;
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_CHANGED',
    });
    browser.tabs = [];
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_TAB',
    });
  });
  it('refuses to invent a closed original group', async () => {
    browser.tabs[0]!.groupId = 30;
    browser.live.push({ ...group(30), title: 'Original', tabIds: [5, 130] });
    const id = await move();
    browser.live = browser.live.filter((g) => g.id !== 30);
    const calls = browser.group.mock.calls.length;
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_GROUP',
    });
    expect(browser.group).toHaveBeenCalledTimes(calls);
  });
  it('refuses an unavailable original window', async () => {
    const id = await move();
    browser.normalWindow = async () => false;
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_WINDOW',
    });
  });
  it('consumes intent before reversing so a partial failure is never repeated', async () => {
    const id = await move();
    browser.ungroup.mockRejectedValueOnce(new Error('Dragging'));
    expect((await engine.dispatch({ type: 'undo', id })).ok).toBe(false);
    expect(await engine.dispatch({ type: 'undo', id })).toMatchObject({
      ok: false,
      code: 'UNDO_EXPIRED',
    });
  });
  it('duplicate concurrent undo performs one reversal', async () => {
    const id = await move();
    const results = await Promise.all([
      engine.dispatch({ type: 'undo', id }),
      engine.dispatch({ type: 'undo', id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(browser.ungroup).toHaveBeenCalledOnce();
  });
  it('undo after recreation leaves the assignment intact and does not close tabs', async () => {
    browser.live = [];
    const id = await move();
    successful(await engine.dispatch({ type: 'undo', id }));
    expect((await repo.load()).destinations[0]?.slot).toBe(1);
    expect(browser.tabs).toHaveLength(1);
  });
  it('a no-op selection preserves the previous undo rather than replacing it', async () => {
    const id = await move();
    successful(await engine.dispatch({ type: 'move', slot: 1, context }));
    expect((await repo.loadSession('session-a', now)).lastMove?.id).toBe(id);
  });
});
