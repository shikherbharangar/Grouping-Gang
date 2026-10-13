import type { Destination, Registry, Slot } from '../shared/types';
import { AppError } from './errors';
export function isSlot(value: unknown): value is Slot {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9;
}
export function requireSlot(value: unknown): asserts value is Slot {
  if (!isSlot(value)) throw new AppError('INVALID_SLOT', 'Choose a number from 1 to 0.');
}
export function assign(registry: Registry, destination: Destination, replace: boolean): Registry {
  requireSlot(destination.slot);
  const other = registry.destinations.find(
    (d) => d.id === destination.id && d.slot !== destination.slot,
  );
  if (other)
    throw new AppError(
      'CONFLICT',
      `This destination already belongs to ${other.slot}. Move its number in settings.`,
    );
  if (
    registry.destinations.some((d) => d.slot === destination.slot && d.id !== destination.id) &&
    !replace
  )
    throw new AppError('CONFLICT', 'That number is already assigned. Confirm replacement first.');
  if (
    destination.binding &&
    registry.destinations.some(
      (d) =>
        d.id !== destination.id &&
        d.slot !== destination.slot &&
        d.binding?.epoch === destination.binding?.epoch &&
        d.binding?.groupId === destination.binding?.groupId,
    )
  )
    throw new AppError('CONFLICT', 'That group already has a number.');
  return {
    ...registry,
    destinations: [
      ...registry.destinations.filter((d) => d.slot !== destination.slot),
      destination,
    ].sort((a, b) => a.slot - b.slot),
  };
}
export function transfer(registry: Registry, from: Slot, to: Slot): Registry {
  requireSlot(from);
  requireSlot(to);
  if (!registry.destinations.some((d) => d.slot === from))
    throw new AppError('EMPTY', 'This number is unassigned.');
  return {
    ...registry,
    destinations: registry.destinations.map((d) =>
      d.slot === from ? { ...d, slot: to } : d.slot === to ? { ...d, slot: from } : d,
    ),
  };
}
