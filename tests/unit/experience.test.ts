import { describe, expect, it, vi } from 'vitest';
import { propose, orderGroups, validateProposal } from '../../src/domain/setup';
import { search } from '../../src/domain/search';
import { resolve } from '../../src/domain/identity';
import { destination, group } from '../fixtures';
import { emptyRegistry, parseRegistry } from '../../src/storage/schema';
import { parseSession, emptySession } from '../../src/storage/session';
import { Launcher } from '../../src/application/launcher';
import { notificationAction } from '../../src/background/notifications';
import { isCommand } from '../../src/application/commands';
const groups = [
  { ...group(40, 2), firstIndex: 0 },
  { ...group(20, 1), firstIndex: 9 },
  { ...group(30, 1), firstIndex: 1 },
  { ...group(10, 3), firstIndex: 0 },
];
describe('first-use proposal', () => {
  it('uses actual tab positions in the active window, then window ID and tab position', () => {
    expect(orderGroups(groups, 1).map((g) => g.id)).toEqual([30, 20, 40, 10]);
  });
  it('is deterministic even when the API returns a different order', () => {
    expect(propose(groups, 1)).toEqual(propose([...groups].reverse(), 1));
  });
  it('maps at most ten groups, with zero last', () => {
    const all = Array.from({ length: 12 }, (_, i) => ({ ...group(i), firstIndex: i }));
    expect(propose(all, 1).map((a) => a.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  });
  it('does not invent groups when none exist', () => {
    expect(propose([], 1)).toEqual([]);
  });
  it('keeps duplicate-title groups distinct through their real IDs', () => {
    expect(new Set(propose(groups, 1).map((a) => a.groupId)).size).toBe(4);
  });
  it('rejects duplicate group selections, occupied numbers and vanished groups', () => {
    expect(() =>
      validateProposal(
        [
          { slot: 1, groupId: 20 },
          { slot: 2, groupId: 20 },
        ],
        groups,
      ),
    ).toThrow();
    expect(() =>
      validateProposal(
        [
          { slot: 1, groupId: 20 },
          { slot: 1, groupId: 30 },
        ],
        groups,
      ),
    ).toThrow();
    expect(() => validateProposal([{ slot: 1, groupId: 99 }], groups)).toThrow();
  });
});
describe('local search', () => {
  const titles = ['Work journal', 'Network', 'My workbench', 'Work', 'Book 2', 'Workbench'];
  const list = titles.map((title, i) =>
    resolve(
      { ...destination(), id: `id-${i}`, slot: (i + 1) as 1, title, binding: null },
      [],
      'session-a',
      null,
    ),
  );
  it('ranks exact, title prefix, word prefix, then substring with stable number ties', () => {
    expect(search(list, 'wOrK').map((d) => d.title)).toEqual([
      'Work',
      'Work journal',
      'Workbench',
      'My workbench',
      'Network',
    ]);
  });
  it('shows all assigned numbers in display order for an empty query', () => {
    const zero = { ...list[0]!, slot: 0 as const };
    expect(search([zero, ...list.slice(1)], '').at(-1)?.slot).toBe(0);
  });
  it('includes missing destinations and treats numeric queries as text', () => {
    expect(search(list, '2').map((d) => d.title)).toEqual(['Book 2']);
    expect(search(list, 'journal')[0]?.state).toBe('missing');
  });
  it('handles whitespace, untitled groups and no matches', () => {
    expect(search(list, '   ')).toHaveLength(6);
    expect(search(list, 'zz')).toHaveLength(0);
    expect(search([{ ...list[0]!, title: '' }], 'untitled')).toHaveLength(1);
  });
  it('never mutates stored slot order', () => {
    const before = structuredClone(list);
    search(list, 'work');
    expect(list).toEqual(before);
  });
});
describe('storage upgrade', () => {
  it('migrates V2 assignments/preferences and skips setup without enabling auto assignment', () => {
    const old = { version: 2, destinations: [destination()], theme: 'dark', pending: null };
    expect(parseRegistry(old)).toEqual({
      ...old,
      version: 3,
      setupCompleted: true,
      autoAssign: false,
    });
  });
  it('a valid empty V2 registry is still a returning user', () => {
    expect(
      parseRegistry({ version: 2, destinations: [], theme: 'system', pending: null })
        .setupCompleted,
    ).toBe(true);
  });
  it('only an absent registry starts first-use setup', () => {
    expect(parseRegistry(undefined)).toEqual(emptyRegistry());
    expect(parseRegistry(undefined).setupCompleted).toBe(false);
  });
  it('rejects corrupt new settings rather than dropping assignments', () => {
    expect(() => parseRegistry({ ...emptyRegistry(), autoAssign: 'yes' })).toThrow();
  });
  it('discards malformed, expired or wrong-session undo metadata', () => {
    expect(parseSession({ epoch: 'a', lastMove: {} }, 'a', 100).lastMove).toBeNull();
    expect(
      parseSession({ ...emptySession('a'), lastMove: { id: 'old', expiresAt: 1 } }, 'a', 100)
        .lastMove,
    ).toBeNull();
    expect(parseSession(emptySession('a'), 'b', 100)).toEqual(emptySession('b'));
  });
  it('validates new command payloads', () => {
    expect(
      isCommand({ type: 'setup', assignments: [{ slot: 1, groupId: 10 }], autoAssign: true }),
    ).toBe(true);
    expect(
      isCommand({ type: 'setup', assignments: [{ slot: 99, groupId: 10 }], autoAssign: true }),
    ).toBe(false);
    expect(isCommand({ type: 'undo', id: '' })).toBe(false);
    expect(isCommand({ type: 'auto-assign', enabled: 'yes' })).toBe(false);
  });
});
describe('launcher source handoff', () => {
  it('captures and stores source before opening; concurrent shortcuts open only once', async () => {
    const events: string[] = [];
    const source = { tabId: 5, windowId: 1, title: 'Page' };
    const host = {
      capture: vi.fn(async () => {
        events.push('capture');
        return source;
      }),
      put: vi.fn(async () => {
        events.push('put');
      }),
      take: vi.fn(async () => source),
      open: vi.fn(async () => {
        events.push('open');
      }),
    };
    const launcher = new Launcher(host);
    await Promise.all([launcher.open(), launcher.open()]);
    expect(events).toEqual(['capture', 'put', 'open']);
    expect(host.open).toHaveBeenCalledOnce();
    expect(await launcher.takeSource()).toEqual(source);
    expect(host.capture).toHaveBeenCalledOnce();
  });
  it('clears a failed handoff and releases the lock for retry', async () => {
    const host = {
      capture: vi.fn(async () => ({ tabId: 5, windowId: 1, title: 'Page' })),
      put: vi.fn(async () => {}),
      take: vi.fn(async () => null),
      open: vi.fn(async () => {}),
    };
    host.open.mockRejectedValueOnce(new Error('Blocked'));
    const launcher = new Launcher(host);
    await expect(launcher.open()).rejects.toThrow('Blocked');
    expect(host.put).toHaveBeenLastCalledWith(null);
    await launcher.open();
    expect(host.open).toHaveBeenCalledTimes(2);
  });
  it('rejects a missing source without creating a surface', async () => {
    const host = {
      capture: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      take: vi.fn(async () => null),
      open: vi.fn(async () => {}),
    };
    await expect(new Launcher(host).open()).rejects.toThrow('Choose a webpage');
    expect(host.open).not.toHaveBeenCalled();
  });
  it('uses toolbar fallback only when no pre-open handoff exists', async () => {
    const host = {
      capture: vi.fn(async () => ({ tabId: 9, windowId: 2, title: 'Other' })),
      put: vi.fn(async () => {}),
      take: vi.fn(async () => null),
      open: vi.fn(async () => {}),
    };
    expect(await new Launcher(host).takeSource()).toMatchObject({ tabId: 9 });
  });
  it('routes only recognized notification undo IDs', () => {
    expect(notificationAction('grouping-gang:move:abc')).toEqual({ type: 'undo', id: 'abc' });
    expect(notificationAction('grouping-gang:assignment:def')).toEqual({
      type: 'undo-assignment',
      id: 'def',
    });
    expect(notificationAction('other:move:abc')).toBeNull();
  });
});
