import { SLOTS } from '../shared/types';
import type { Slot } from '../shared/types';
export function numberKey(key: string): Slot | null {
  return /^[0-9]$/.test(key) ? (Number(key) as Slot) : null;
}
export function nextIndex(index: number, key: string): number {
  return (index + (key === 'ArrowUp' ? -1 : 1) + SLOTS.length) % SLOTS.length;
}
