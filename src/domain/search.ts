import { SLOTS } from '../shared/types';
import type { DestinationView } from '../shared/types';
export function search(destinations: DestinationView[], query: string): DestinationView[] {
  const q = query.trim().toLocaleLowerCase('en-US');
  function rank(title: string): number {
    const t = title.toLocaleLowerCase('en-US');
    if (!q || t === q) return 0;
    if (t.startsWith(q)) return 1;
    if (t.split(/[\s\p{P}]+/u).some((word) => word.startsWith(q))) return 2;
    return t.includes(q) ? 3 : 4;
  }
  return destinations
    .filter((d) => rank(d.title || 'Untitled group') < 4)
    .sort(
      (a, b) =>
        rank(a.title || 'Untitled group') - rank(b.title || 'Untitled group') ||
        SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot),
    );
}
