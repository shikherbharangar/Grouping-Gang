import type { Destination, DestinationView, LiveGroup, Registry } from '../shared/types';
export function resolve(
  destination: Destination,
  groups: LiveGroup[],
  epoch: string,
  pending: Registry['pending'],
): DestinationView {
  // IDs are trusted only within the browser session that issued them. Similar names
  // are suggestions for explicit rebinding, never evidence for an automatic move.
  const group =
    destination.binding?.epoch === epoch
      ? groups.find((g) => g.id === destination.binding?.groupId)
      : undefined;
  const interrupted = pending?.destinationId === destination.id;
  const candidates = groups
    .filter(
      (g) =>
        (g.title === destination.title && g.color === destination.color) ||
        (destination.binding?.epoch === epoch &&
          g.tabIds.some((id) => destination.binding?.tabIds.includes(id))) ||
        (interrupted && pending?.epoch === epoch && g.tabIds.includes(pending.tabId)),
    )
    .map((g) => g.id);
  return {
    ...destination,
    state: group && !interrupted ? 'live' : candidates.length ? 'ambiguous' : 'missing',
    group: group && !interrupted ? group : null,
    candidates,
    interrupted,
  };
}
export function reconcile(
  registry: Registry,
  groups: LiveGroup[],
  epoch: string,
  now: number,
): Registry {
  return {
    ...registry,
    destinations: registry.destinations.map((d) => {
      const view = resolve(d, groups, epoch, registry.pending);
      if (!view.group) return d;
      const g = view.group;
      const binding = {
        epoch,
        groupId: g.id,
        windowId: g.windowId,
        tabIds: [...g.tabIds].sort((a, b) => a - b),
      };
      const changed =
        d.title !== g.title ||
        d.color !== g.color ||
        JSON.stringify(d.binding) !== JSON.stringify(binding);
      return changed ? { ...d, title: g.title, color: g.color, binding, lastSeenAt: now } : d;
    }),
  };
}
