export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
export type Slot = (typeof SLOTS)[number];
export const COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;
export type Color = (typeof COLORS)[number];
export type Theme = 'system' | 'light' | 'dark';
export interface Binding {
  epoch: string;
  groupId: number;
  windowId: number;
  tabIds: number[];
}
export interface Destination {
  id: string;
  slot: Slot;
  title: string;
  color: Color;
  lastSeenAt: number;
  binding: Binding | null;
}
export interface PendingRecovery {
  destinationId: string;
  epoch: string;
  tabId: number;
  previousGroupId: number;
  createdGroupId: number | null;
}
export interface Registry {
  version: 2;
  destinations: Destination[];
  theme: Theme;
  pending: PendingRecovery | null;
}
export interface LiveGroup {
  id: number;
  windowId: number;
  title: string;
  color: Color;
  collapsed: boolean;
  tabIds: number[];
}
export interface TabContext {
  tabId: number;
  windowId: number;
}
export interface BrowserTab {
  id: number;
  windowId: number;
  groupId: number;
  active: boolean;
  pinned: boolean;
  incognito: boolean;
  title: string;
  url?: string;
}
export interface DestinationView extends Destination {
  state: 'live' | 'missing' | 'ambiguous';
  group: LiveGroup | null;
  candidates: number[];
  interrupted: boolean;
}
export interface StateView {
  destinations: DestinationView[];
  groups: LiveGroup[];
  theme: Theme;
  context: TabContext | null;
  tabTitle: string;
  shortcut: string;
  version: string;
}
export interface ClosedTab {
  sessionId: string;
  title: string;
  lastModified: number;
}
export type Command =
  | { type: 'state'; capture?: boolean }
  | { type: 'move'; slot: Slot; context: TabContext }
  | { type: 'assign'; slot: Slot; groupId: number; replace: boolean }
  | { type: 'transfer'; from: Slot; to: Slot }
  | { type: 'forget'; slot: Slot }
  | { type: 'recover'; slot: Slot; context: TabContext | null; sessionId?: string }
  | { type: 'sessions' }
  | { type: 'theme'; theme: Theme }
  | { type: 'reset' };
export type Result =
  | { ok: true; state?: StateView; sessions?: ClosedTab[]; outcome?: string }
  | { ok: false; code: string; message: string };
