import { vi } from 'vitest';
import type { BrowserGateway } from '../src/browser/gateway';
import type { Repository } from '../src/storage/repository';
import { parseSession } from '../src/storage/session';
import { emptyRegistry, parseRegistry } from '../src/storage/schema';
import type {
  BrowserTab,
  ClosedTab,
  Destination,
  LiveGroup,
  Registry,
  SessionState,
} from '../src/shared/types';
export const ID = '00000000-0000-4000-8000-000000000001';
export const ID2 = '00000000-0000-4000-8000-000000000002';
export const group = (id = 10, windowId = 1): LiveGroup => ({
  id,
  windowId,
  title: 'Research',
  color: 'green',
  collapsed: false,
  tabIds: [id + 100],
  firstIndex: id,
});
export const destination = (): Destination => ({
  id: ID,
  slot: 1,
  title: 'Research',
  color: 'green',
  lastSeenAt: 1,
  binding: { epoch: 'session-a', groupId: 10, windowId: 1, tabIds: [110] },
});
export const registry = (): Registry => ({ ...emptyRegistry(), destinations: [destination()] });
export class MemoryRepository implements Repository {
  data: unknown = registry();
  writes = 0;
  session: unknown = undefined;
  async loadSession(epoch: string, now: number) {
    return structuredClone(parseSession(this.session, epoch, now));
  }
  async saveSession(value: SessionState): Promise<void> {
    this.session = structuredClone(value);
  }
  async load(): Promise<Registry> {
    return structuredClone(parseRegistry(this.data));
  }
  async save(value: Registry): Promise<void> {
    this.data = structuredClone(parseRegistry(value));
    this.writes++;
  }
  async reset(): Promise<void> {
    this.data = emptyRegistry();
    this.session = undefined;
  }
}
export class FakeBrowser implements BrowserGateway {
  sessionEpoch = 'session-a';
  live: LiveGroup[] = [group()];
  tabs: BrowserTab[] = [
    {
      id: 5,
      windowId: 1,
      groupId: -1,
      index: 4,
      active: true,
      pinned: false,
      incognito: false,
      title: 'Source',
      url: 'https://example.test',
    },
  ];
  closed: ClosedTab[] = [{ sessionId: 'closed-1', title: 'Closed page', lastModified: 10 }];
  nextGroup = 20;
  async epoch(): Promise<string> {
    return this.sessionEpoch;
  }
  async groups(): Promise<LiveGroup[]> {
    return structuredClone(this.live);
  }
  async activeTab(): Promise<BrowserTab | null> {
    return structuredClone(this.tabs.find((t) => t.active) || null);
  }
  async tab(id: number): Promise<BrowserTab> {
    const t = this.tabs.find((t) => t.id === id);
    if (!t) throw new Error('Tab missing');
    return structuredClone(t);
  }
  async normalWindow(): Promise<boolean> {
    return true;
  }
  move = vi.fn(async (id: number, windowId: number, index = -1): Promise<void> => {
    const t = this.tabs.find((t) => t.id === id)!;
    if (t.windowId !== windowId) t.groupId = -1;
    t.windowId = windowId;
    if (index >= 0) t.index = index;
  });
  ungroup = vi.fn(async (id: number): Promise<void> => {
    this.tabs.find((t) => t.id === id)!.groupId = -1;
    for (const g of this.live) g.tabIds = g.tabIds.filter((t) => t !== id);
  });
  group = vi.fn(async (ids: number[], groupId?: number): Promise<number> => {
    let g = this.live.find((g) => g.id === groupId);
    if (groupId !== undefined && !g) throw new Error('Group closed');
    if (!g) {
      g = {
        ...group(this.nextGroup++, this.tabs.find((t) => t.id === ids[0])!.windowId),
        title: '',
        color: 'grey',
        tabIds: [],
      };
      this.live.push(g);
    }
    for (const id of ids) {
      const tab = this.tabs.find((t) => t.id === id)!;
      if (tab.windowId !== g.windowId) throw new Error('Wrong window');
      tab.groupId = g.id;
      for (const other of this.live) other.tabIds = other.tabIds.filter((t) => t !== id);
      g.tabIds.push(id);
    }
    return g.id;
  });
  updateGroup = vi.fn(
    async (
      id: number,
      properties: { title?: string; color?: LiveGroup['color']; collapsed?: boolean },
    ): Promise<void> => {
      Object.assign(
        this.live.find((g) => g.id === id)!,
        properties,
      );
    },
  );
  activate = vi.fn(async (id: number): Promise<void> => {
    this.tabs.forEach((t) => {
      t.active = t.id === id;
    });
  });
  createTab = vi.fn(async (): Promise<BrowserTab> => {
    const t: BrowserTab = {
      id: 200,
      windowId: 1,
      groupId: -1,
      index: 4,
      active: false,
      pinned: false,
      incognito: false,
      title: 'Blank',
    };
    this.tabs.push(t);
    return structuredClone(t);
  });
  async sessions(): Promise<ClosedTab[]> {
    return this.closed;
  }
  restoreTab = vi.fn(async (sessionId: string): Promise<BrowserTab> => {
    if (!this.closed.some((s) => s.sessionId === sessionId)) throw new Error('Missing session');
    this.closed = [];
    const t: BrowserTab = {
      id: 201,
      windowId: 2,
      groupId: -1,
      index: 4,
      active: true,
      pinned: false,
      incognito: false,
      title: 'Restored',
    };
    this.tabs.push(t);
    return structuredClone(t);
  });
  async shortcut(): Promise<string> {
    return 'Ctrl+Shift+Period';
  }
}
