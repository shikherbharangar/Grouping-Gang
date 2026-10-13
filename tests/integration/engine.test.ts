import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/application/engine';
import { FakeBrowser, MemoryRepository, destination, group, registry } from '../fixtures';
let browser: FakeBrowser;
let repo: MemoryRepository;
let engine: Engine;
const context = { tabId: 5, windowId: 1 };
beforeEach(() => {
  browser = new FakeBrowser();
  repo = new MemoryRepository();
  engine = new Engine(repo, browser, () => 100);
});
describe('browser operations', () => {
  it('moves the captured tab to the existing group without creating a tab', async () => {
    expect((await engine.dispatch({ type: 'move', slot: 1, context })).ok).toBe(true);
    expect(browser.group).toHaveBeenCalledWith([5], 10);
    expect(browser.tabs[0]?.groupId).toBe(10);
    expect(browser.createTab).not.toHaveBeenCalled();
  });
  it('expands a collapsed destination without changing title or color', async () => {
    browser.live[0]!.collapsed = true;
    await engine.dispatch({ type: 'move', slot: 1, context });
    expect(browser.updateGroup).toHaveBeenCalledWith(10, { collapsed: false });
    expect(browser.live).toHaveLength(1);
  });
  it('moves to another window then groups and focuses the original tab', async () => {
    browser.live[0]!.windowId = 2;
    const response = await engine.dispatch({ type: 'move', slot: 1, context });
    expect(response.ok).toBe(true);
    expect(browser.move).toHaveBeenCalledWith(5, 2);
    expect(browser.activate).toHaveBeenCalledWith(5, 2);
  });
  it('rejects pinned tabs without unpinning', async () => {
    browser.tabs[0]!.pinned = true;
    expect(await engine.dispatch({ type: 'move', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'PINNED',
    });
    expect(browser.group).not.toHaveBeenCalled();
  });
  it('rejects a changed active tab', async () => {
    browser.tabs[0]!.active = false;
    expect(await engine.dispatch({ type: 'move', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'STALE_TAB',
    });
    expect(browser.group).not.toHaveBeenCalled();
  });
  it('rejects extension pages and private tabs', async () => {
    browser.tabs[0]!.url = 'chrome-extension://abc/settings';
    expect((await engine.dispatch({ type: 'move', slot: 1, context })).ok).toBe(false);
    browser.tabs[0]!.url = 'https://example.test';
    browser.tabs[0]!.incognito = true;
    expect((await engine.dispatch({ type: 'move', slot: 1, context })).ok).toBe(false);
  });
  it('keeps assignments when movement fails and releases the queue', async () => {
    browser.group.mockRejectedValueOnce(new Error('Tab is being dragged'));
    expect((await engine.dispatch({ type: 'move', slot: 1, context })).ok).toBe(false);
    expect((await repo.load()).destinations).toHaveLength(1);
    expect((await engine.dispatch({ type: 'move', slot: 1, context })).ok).toBe(true);
  });
  it('does not create success when grouping was not applied', async () => {
    browser.group.mockResolvedValueOnce(10);
    expect(await engine.dispatch({ type: 'move', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'VERIFY',
    });
  });
  it('preserves a removed group’s slot and rejects reused IDs', async () => {
    browser.live = [];
    await engine.reconcileEvent(10);
    browser.live = [group()];
    await engine.reconcileEvent();
    expect((await repo.load()).destinations[0]?.binding).toBeNull();
    expect(await engine.dispatch({ type: 'move', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'AMBIGUOUS',
    });
  });
  it('supports service-worker restart without forgetting bindings', async () => {
    engine = new Engine(repo, browser);
    expect((await engine.dispatch({ type: 'move', slot: 1, context })).ok).toBe(true);
  });
  it('browser-session restart requires rebinding instead of guessing', async () => {
    browser.sessionEpoch = 'next-session';
    expect(await engine.dispatch({ type: 'move', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'AMBIGUOUS',
    });
  });
  it('coalesced or duplicate events do not repeatedly write storage', async () => {
    await engine.reconcileEvent();
    const writes = repo.writes;
    await Promise.all([engine.reconcileEvent(), engine.reconcileEvent()]);
    expect(repo.writes).toBe(writes);
  });
  it('opening and dismissing performs no browser mutation', async () => {
    await engine.dispatch({ type: 'state', capture: true });
    expect(browser.group).not.toHaveBeenCalled();
    expect(browser.move).not.toHaveBeenCalled();
    expect(browser.createTab).not.toHaveBeenCalled();
  });
});
describe('missing destinations and recovery', () => {
  beforeEach(() => {
    browser.live = [];
  });
  it('recreates using the current tab, saved title and color', async () => {
    const response = await engine.dispatch({ type: 'recover', slot: 1, context });
    expect(response).toMatchObject({
      ok: true,
      outcome: 'Destination recreated. Previous tabs were not restored.',
    });
    expect(browser.live[0]).toMatchObject({ title: 'Research', color: 'green', tabIds: [5] });
    expect((await repo.load()).pending).toBeNull();
  });
  it('creates a blank tab only for explicit settings recreation', async () => {
    expect((await engine.dispatch({ type: 'recover', slot: 1, context: null })).ok).toBe(true);
    expect(browser.createTab).toHaveBeenCalledOnce();
  });
  it('restores only an explicitly selected individual closed tab', async () => {
    const response = await engine.dispatch({
      type: 'recover',
      slot: 1,
      context,
      sessionId: 'closed-1',
    });
    expect(response).toMatchObject({
      ok: true,
      outcome:
        'Destination recreated with one recovered tab. Other previous tabs were not restored.',
    });
    expect(browser.restoreTab).toHaveBeenCalledWith('closed-1');
    expect(browser.live[0]?.tabIds).toEqual([5, 201]);
  });
  it('does not blindly restore a vanished session', async () => {
    expect(
      (await engine.dispatch({ type: 'recover', slot: 1, context, sessionId: 'vanished' })).ok,
    ).toBe(false);
    expect(browser.restoreTab).not.toHaveBeenCalled();
    expect((await repo.load()).pending).toBeNull();
  });
  it('serializes duplicate recovery requests without creating duplicates', async () => {
    const results = await Promise.all([
      engine.dispatch({ type: 'recover', slot: 1, context }),
      engine.dispatch({ type: 'recover', slot: 1, context }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(browser.live).toHaveLength(1);
  });
  it('reuses a group that returns before recovery', async () => {
    browser.live = [group()];
    await engine.dispatch({ type: 'recover', slot: 1, context });
    expect(browser.live).toHaveLength(1);
    expect(browser.group).toHaveBeenCalledWith([5], 10);
  });
  it('blocks recovery if a plausible group already exists', async () => {
    browser.live = [group(99)];
    expect(await engine.dispatch({ type: 'recover', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'AMBIGUOUS',
    });
    expect(browser.group).not.toHaveBeenCalled();
  });
  it('journals partial failures and prevents repeat recovery after restart', async () => {
    browser.updateGroup.mockRejectedValueOnce(new Error('Worker interruption'));
    expect((await engine.dispatch({ type: 'recover', slot: 1, context })).ok).toBe(false);
    expect((await repo.load()).pending).not.toBeNull();
    engine = new Engine(repo, browser);
    expect(await engine.dispatch({ type: 'recover', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'INTERRUPTED',
    });
    expect(browser.live).toHaveLength(1);
  });
  it('explicit rebinding resolves interrupted recovery', async () => {
    browser.updateGroup.mockRejectedValueOnce(new Error('Interrupted'));
    await engine.dispatch({ type: 'recover', slot: 1, context });
    const id = browser.live[0]!.id;
    expect(
      (await engine.dispatch({ type: 'assign', slot: 1, groupId: id, replace: true })).ok,
    ).toBe(true);
    expect((await repo.load()).pending).toBeNull();
  });
  it('rejects ambiguous moves without altering assignments', async () => {
    browser.live = [group(20), group(30)];
    const before = await repo.load();
    expect(await engine.dispatch({ type: 'move', slot: 1, context })).toMatchObject({
      ok: false,
      code: 'AMBIGUOUS',
    });
    expect((await repo.load()).destinations).toEqual(before.destinations);
  });
});
describe('persistent settings', () => {
  it('persists appearance across worker instances', async () => {
    await engine.dispatch({ type: 'theme', theme: 'dark' });
    engine = new Engine(repo, browser);
    expect(await engine.dispatch({ type: 'state' })).toMatchObject({
      ok: true,
      state: { theme: 'dark' },
    });
  });
  it('preserves corrupted storage until explicit reset', async () => {
    repo.data = { version: 99, userData: 'keep' };
    expect(await engine.dispatch({ type: 'state' })).toMatchObject({ ok: false, code: 'STORAGE' });
    expect(repo.data).toEqual({ version: 99, userData: 'keep' });
    expect((await engine.dispatch({ type: 'reset' })).ok).toBe(true);
  });
  it('binds a missing assignment without changing its UUID', async () => {
    repo.data = { ...registry(), destinations: [{ ...destination(), binding: null }] };
    await engine.dispatch({ type: 'assign', slot: 1, groupId: 10, replace: true });
    expect((await repo.load()).destinations[0]?.id).toBe(destination().id);
  });
  it('unassigning never closes tabs or groups', async () => {
    await engine.dispatch({ type: 'forget', slot: 1 });
    expect((await repo.load()).destinations).toHaveLength(0);
    expect(browser.live).toHaveLength(1);
    expect(browser.tabs).toHaveLength(1);
  });
});
