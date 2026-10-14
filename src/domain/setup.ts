import { SLOTS } from '../shared/types';
import type { Destination, LiveGroup, ProposedAssignment } from '../shared/types';
import { AppError } from './errors';
import { isSlot } from './assignment';
export function orderGroups(groups: LiveGroup[], activeWindowId: number | null): LiveGroup[] {
  return [...groups].sort(
    (a, b) =>
      Number(b.windowId === activeWindowId) - Number(a.windowId === activeWindowId) ||
      a.windowId - b.windowId ||
      a.firstIndex - b.firstIndex ||
      a.id - b.id,
  );
}
export function propose(groups: LiveGroup[], activeWindowId: number | null): ProposedAssignment[] {
  return orderGroups(groups, activeWindowId)
    .slice(0, 10)
    .map((g, i) => ({ slot: SLOTS[i]!, groupId: g.id }));
}
export function validateProposal(assignments: ProposedAssignment[], groups: LiveGroup[]): void {
  if (
    assignments.length > 10 ||
    assignments.some((a) => !isSlot(a.slot) || !groups.some((g) => g.id === a.groupId)) ||
    new Set(assignments.map((a) => a.slot)).size !== assignments.length ||
    new Set(assignments.map((a) => a.groupId)).size !== assignments.length
  )
    throw new AppError(
      'SETUP',
      'Groups changed or two numbers use the same group. Review the mapping and try again.',
    );
}
export function fromGroup(
  group: LiveGroup,
  slot: Destination['slot'],
  epoch: string,
  now: number,
): Destination {
  return {
    id: crypto.randomUUID(),
    slot,
    title: group.title,
    color: group.color,
    lastSeenAt: now,
    binding: { epoch, groupId: group.id, windowId: group.windowId, tabIds: group.tabIds },
  };
}
