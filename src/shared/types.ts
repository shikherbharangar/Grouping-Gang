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
  version: 3;
  destinations: Destination[];
  theme: Theme;
  pending: PendingRecovery | null;
  setupCompleted: boolean;
  autoAssign: boolean;
}
export interface LiveGroup {
  id: number;
  windowId: number;
  title: string;
  color: Color;
  collapsed: boolean;
  tabIds: number[];
  firstIndex: number;
}
export interface TabContext {
  tabId: number;
  windowId: number;
}
export interface CapturedSource extends TabContext {
  title: string;
}
export interface BrowserTab {
  id: number;
  windowId: number;
  groupId: number;
  index: number;
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
export interface MoveUndo {
  id: string;
  epoch: string;
  tabId: number;
  fromWindowId: number;
  fromIndex: number;
  fromGroupId: number;
  toWindowId: number;
  toGroupId: number;
  destinationId: string;
  createdAt: number;
  expiresAt: number;
}
export interface AssignmentUndo {
  id: string;
  destinations: Destination[];
  expiresAt: number;
}
export interface Notice {
  id: string;
  kind: 'move' | 'assignment';
  message: string;
  expiresAt: number;
}
export interface SessionState {
  epoch: string;
  knownGroups: number[] | null;
  lastMove: MoveUndo | null;
  assignmentUndo: AssignmentUndo | null;
  notice: Notice | null;
}
export interface StateView {
  destinations: DestinationView[];
  groups: LiveGroup[];
  theme: Theme;
  context: TabContext | null;
  tabTitle: string;
  shortcut: string;
  version: string;
  setupCompleted: boolean;
  autoAssign: boolean;
  undo: MoveUndo | null;
  assignmentUndo: { id: string; expiresAt: number } | null;
  notice: Notice | null;
}
export interface ClosedTab {
  sessionId: string;
  title: string;
  lastModified: number;
}
export interface ProposedAssignment {
  slot: Slot;
  groupId: number;
}
export type Command =
  | { type: 'state'; capture?: boolean }
  | { type: 'setup'; assignments: ProposedAssignment[]; autoAssign: boolean }
  | { type: 'auto-assign'; enabled: boolean }
  | { type: 'undo'; id: string }
  | { type: 'undo-assignment'; id: string }
  | { type: 'dismiss-notice'; id: string }
  | { type: 'move'; slot: Slot; context: TabContext }
  | { type: 'assign'; slot: Slot; groupId: number; replace: boolean }
  | { type: 'transfer'; from: Slot; to: Slot }
  | { type: 'forget'; slot: Slot }
  | { type: 'recover'; slot: Slot; context: TabContext | null; sessionId?: string }
  | { type: 'sessions' }
  | { type: 'theme'; theme: Theme }
  | { type: 'reset' };
export type Result =
  | { ok: true; state?: StateView; sessions?: ClosedTab[]; outcome?: string; notice?: Notice }
  | { ok: false; code: string; message: string };
