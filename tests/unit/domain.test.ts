import { describe, expect, it } from 'vitest';
import { assign, isSlot, transfer } from '../../src/domain/assignment';
import { reconcile, resolve } from '../../src/domain/identity';
import { emptyRegistry, parseRegistry } from '../../src/storage/schema';
import { isCommand } from '../../src/application/commands';
import { numberKey, nextIndex } from '../../src/switcher/keyboard';
import { SLOTS } from '../../src/shared/types';
import { destination, group, ID2, registry } from '../fixtures';
describe('assignment invariants', () => {
  it.each(SLOTS)('assigns slot %s without renumbering', (slot) => {
    const next = assign(emptyRegistry(), { ...destination(), slot }, false);
    expect(next.destinations[0]?.slot).toBe(slot);
  });
  it.each([-1, 10, 1.5, NaN, Infinity, '1', null, undefined])('rejects invalid slot %s', (slot) => {
    expect(isSlot(slot)).toBe(false);
  });
  it('rejects occupied slots without confirmation', () => {
    expect(() => assign(registry(), { ...destination(), id: ID2 }, false)).toThrow(
      'already assigned',
    );
  });
  it('allows confirmed replacement', () => {
    expect(assign(registry(), { ...destination(), id: ID2 }, true).destinations).toHaveLength(1);
  });
  it('does not duplicate a persistent identity', () => {
    expect(() => assign(registry(), { ...destination(), slot: 2 }, true)).toThrow(
      'already belongs',
    );
  });
  it('does not bind one group twice', () => {
    expect(() => assign(registry(), { ...destination(), id: ID2, slot: 2 }, false)).toThrow(
      'already has a number',
    );
  });
  it('swaps occupied numbers explicitly', () => {
    const r = registry();
    r.destinations.push({ ...destination(), id: ID2, slot: 0, binding: null });
    expect(transfer(r, 1, 0).destinations.map((d) => d.slot)).toEqual([0, 1]);
  });
  it('does not mutate the source registry', () => {
    const r = registry();
    transfer(r, 1, 0);
    expect(r.destinations[0]?.slot).toBe(1);
  });
});
describe('identity and reconciliation', () => {
  it('recognizes collapsed live groups', () => {
    expect(resolve(destination(), [{ ...group(), collapsed: true }], 'session-a', null).state).toBe(
      'live',
    );
  });
  it('retains missing assignments', () => {
    const r = reconcile(registry(), [], 'session-a', 5);
    expect(r.destinations[0]?.slot).toBe(1);
    expect(resolve(r.destinations[0]!, [], 'session-a', null).state).toBe('missing');
  });
  it('updates renamed groups and window context within the same browser session', () => {
    const next = reconcile(
      registry(),
      [{ ...group(10, 2), title: 'Renamed', color: 'blue' }],
      'session-a',
      5,
    );
    expect(next.destinations[0]).toMatchObject({
      title: 'Renamed',
      color: 'blue',
      binding: { windowId: 2 },
    });
  });
  it('never trusts recycled group IDs after browser restart', () => {
    expect(resolve(destination(), [group()], 'session-b', null).state).toBe('ambiguous');
  });
  it('requires explicit confirmation even for one title/color match', () => {
    expect(
      resolve({ ...destination(), binding: null }, [group()], 'session-a', null).group,
    ).toBeNull();
  });
  it('does not merge duplicate group names', () => {
    const view = resolve(
      { ...destination(), binding: null },
      [group(), group(11, 2)],
      'session-a',
      null,
    );
    expect(view.state).toBe('ambiguous');
    expect(view.candidates).toEqual([10, 11]);
  });
  it('uses membership as supporting evidence without automatically rebinding', () => {
    const view = resolve(
      destination(),
      [{ ...group(99), title: 'Renamed', tabIds: [110] }],
      'session-a',
      null,
    );
    expect(view.state).toBe('ambiguous');
    expect(view.group).toBeNull();
  });
  it('is idempotent across duplicate events, without repeated timestamps', () => {
    const next = reconcile(registry(), [{ ...group(), title: 'New' }], 'session-a', 10);
    expect(reconcile(next, [{ ...group(), title: 'New' }], 'session-a', 20)).toEqual(next);
  });
});
describe('storage and request validation', () => {
  it('roundtrips persistent assignments and theme', () => {
    const r = { ...registry(), theme: 'dark' as const };
    expect(parseRegistry(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it('migrates version 1 without losing numbers or appearance', () => {
    const r = { ...registry(), version: 1, theme: 'light' };
    delete (r as Partial<typeof r>).pending;
    expect(parseRegistry(r)).toMatchObject({
      version: 2,
      theme: 'light',
      pending: null,
      destinations: [{ slot: 1 }],
    });
  });
  it.each([
    null,
    {},
    { version: 99 },
    { ...registry(), theme: 'invalid' },
    { ...registry(), pending: {} },
  ])('rejects corrupted or unsupported data', (value) => {
    expect(() => parseRegistry(value)).toThrow();
  });
  it('rejects duplicate assignments instead of silently dropping them', () => {
    const r = registry();
    r.destinations.push(destination());
    expect(() => parseRegistry(r)).toThrow('Conflicting');
  });
  it('represents empty slots through absence of an assignment', () => {
    expect(parseRegistry(undefined)).toEqual(emptyRegistry());
  });
  it.each([
    { type: 'move', slot: 10 },
    { type: 'recover', slot: 1, context: null, sessionId: '' },
    { type: 'theme', theme: 'purple' },
    { type: 'assign', slot: 1, groupId: -1, replace: false },
    null,
  ])('rejects malformed commands', (command) => {
    expect(isCommand(command)).toBe(false);
  });
});
describe('keyboard decisions', () => {
  it.each(SLOTS)('maps number %s', (slot) => {
    expect(numberKey(String(slot))).toBe(slot);
  });
  it('never maps Escape or Enter to a number', () => {
    expect(numberKey('Escape')).toBeNull();
    expect(numberKey('Enter')).toBeNull();
  });
  it('wraps in displayed order including zero', () => {
    expect(nextIndex(8, 'ArrowDown')).toBe(9);
    expect(nextIndex(9, 'ArrowDown')).toBe(0);
    expect(nextIndex(0, 'ArrowUp')).toBe(9);
  });
});
