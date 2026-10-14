import type { SessionState, Destination } from '../shared/types';
import { object, integer } from './schema';
export const UNDO_MS = 30_000;
export const NOTICE_MS = 5_000;
export function emptySession(epoch: string): SessionState {
  return { epoch, knownGroups: null, lastMove: null, assignmentUndo: null, notice: null };
}
export function parseSession(value: unknown, epoch: string, now: number): SessionState {
  // Session metadata is disposable. Reject malformed/old state rather than risking a reversal.
  if (!object(value) || value.epoch !== epoch) return emptySession(epoch);
  const next = emptySession(epoch);
  if (
    value.knownGroups === null ||
    (Array.isArray(value.knownGroups) &&
      value.knownGroups.length <= 10000 &&
      value.knownGroups.every(integer))
  )
    next.knownGroups = value.knownGroups as number[] | null;
  const u = value.lastMove;
  if (
    object(u) &&
    typeof u.id === 'string' &&
    u.epoch === epoch &&
    typeof u.destinationId === 'string' &&
    [
      'tabId',
      'fromWindowId',
      'fromIndex',
      'toWindowId',
      'toGroupId',
      'createdAt',
      'expiresAt',
    ].every((k) => integer(u[k])) &&
    typeof u.fromGroupId === 'number' &&
    Number.isInteger(u.fromGroupId) &&
    u.fromGroupId >= -1 &&
    (u.expiresAt as number) > now &&
    (u.expiresAt as number) - (u.createdAt as number) <= UNDO_MS &&
    (u.createdAt as number) <= now
  )
    next.lastMove = u as unknown as SessionState['lastMove'];
  const a = value.assignmentUndo;
  if (
    object(a) &&
    typeof a.id === 'string' &&
    integer(a.expiresAt) &&
    a.expiresAt > now &&
    a.expiresAt <= now + UNDO_MS &&
    Array.isArray(a.destinations) &&
    a.destinations.length <= 10
  ) {
    // Reuse the persistent registry's complete validation for assignment snapshots.
    try {
      const r = validateAssignments(a.destinations);
      next.assignmentUndo = { id: a.id, expiresAt: a.expiresAt, destinations: r };
    } catch {
      /* Invalid ephemeral undo is discarded; assignments remain untouched. */
    }
  }
  const n = value.notice;
  if (
    object(n) &&
    typeof n.id === 'string' &&
    typeof n.message === 'string' &&
    n.message.length <= 1000 &&
    (n.kind === 'move' || n.kind === 'assignment') &&
    integer(n.expiresAt) &&
    n.expiresAt > now &&
    n.expiresAt <= now + NOTICE_MS
  )
    next.notice = n as unknown as SessionState['notice'];
  return next;
}
import { parseRegistry } from './schema';
function validateAssignments(destinations: unknown[]): Destination[] {
  return parseRegistry({
    version: 3,
    destinations,
    pending: null,
    theme: 'system',
    setupCompleted: true,
    autoAssign: false,
  }).destinations;
}
