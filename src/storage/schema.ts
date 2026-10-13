import { COLORS } from '../shared/types';
import type { Binding, Destination, Registry, Theme } from '../shared/types';
import { isSlot } from '../domain/assignment';
import { AppError } from '../domain/errors';
export const emptyRegistry = (): Registry => ({
  version: 2,
  destinations: [],
  theme: 'system',
  pending: null,
});
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}
export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}
function binding(value: unknown): value is Binding | null {
  return (
    value === null ||
    (object(value) &&
      typeof value.epoch === 'string' &&
      integer(value.groupId) &&
      integer(value.windowId) &&
      Array.isArray(value.tabIds) &&
      value.tabIds.length <= 10000 &&
      value.tabIds.every(integer))
  );
}
function destination(value: unknown): value is Destination {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9-]{36}$/i.test(value.id) &&
    isSlot(value.slot) &&
    typeof value.title === 'string' &&
    value.title.length <= 10000 &&
    COLORS.includes(value.color as Destination['color']) &&
    integer(value.lastSeenAt) &&
    binding(value.binding)
  );
}
export function parseRegistry(value: unknown): Registry {
  if (value === undefined) return emptyRegistry();
  // Version 1 had the same assignment shape, but no interrupted-recovery journal.
  if (object(value) && value.version === 1) value = { ...value, version: 2, pending: null };
  if (
    !object(value) ||
    value.version !== 2 ||
    !Array.isArray(value.destinations) ||
    value.destinations.length > 10 ||
    !value.destinations.every(destination) ||
    !isTheme(value.theme)
  )
    throw new AppError(
      'STORAGE',
      'Saved data is invalid or from a newer version. It has been preserved. Use a compatible version, or reset in settings.',
    );
  const list = value.destinations as Destination[];
  const bindings = list
    .filter((d) => d.binding)
    .map((d) => `${d.binding?.epoch}:${d.binding?.groupId}`);
  if (
    new Set(list.map((d) => d.slot)).size !== list.length ||
    new Set(list.map((d) => d.id)).size !== list.length ||
    new Set(bindings).size !== bindings.length
  )
    throw new AppError(
      'STORAGE',
      'Conflicting assignments were preserved. Reset in settings to start again.',
    );
  const p = value.pending;
  if (
    p !== null &&
    (!object(p) ||
      typeof p.destinationId !== 'string' ||
      !list.some((d) => d.id === p.destinationId) ||
      typeof p.epoch !== 'string' ||
      !integer(p.tabId) ||
      !Number.isInteger(p.previousGroupId) ||
      typeof p.previousGroupId !== 'number' ||
      p.previousGroupId < -1 ||
      !(p.createdGroupId === null || integer(p.createdGroupId)))
  )
    throw new AppError(
      'STORAGE',
      'Recovery data is invalid. Saved assignments have been preserved.',
    );
  return value as unknown as Registry;
}
