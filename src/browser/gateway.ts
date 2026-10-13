import type { BrowserTab, ClosedTab, Color, LiveGroup } from '../shared/types';
import { AppError } from '../domain/errors';
export interface BrowserGateway {
  epoch(): Promise<string>;
  groups(): Promise<LiveGroup[]>;
  activeTab(): Promise<BrowserTab | null>;
  tab(id: number): Promise<BrowserTab>;
  normalWindow(id: number): Promise<boolean>;
  move(id: number, windowId: number): Promise<void>;
  group(tabIds: number[], groupId?: number): Promise<number>;
  updateGroup(
    id: number,
    properties: { title?: string; color?: Color; collapsed?: boolean },
  ): Promise<void>;
  activate(id: number, windowId: number): Promise<void>;
  createTab(): Promise<BrowserTab>;
  sessions(): Promise<ClosedTab[]>;
  restoreTab(sessionId: string): Promise<BrowserTab>;
  shortcut(): Promise<string>;
}
function mapTab(tab: chrome.tabs.Tab): BrowserTab {
  if (tab.id === undefined)
    throw new AppError('TAB_MISSING', 'This tab is no longer available. Reopen the switcher.');
  return {
    id: tab.id,
    windowId: tab.windowId,
    groupId: tab.groupId,
    active: tab.active,
    pinned: tab.pinned,
    incognito: tab.incognito,
    title: tab.title || 'Current tab',
    url: tab.url,
  };
}
export class ChromeBrowser implements BrowserGateway {
  async epoch(): Promise<string> {
    const data = await chrome.storage.session.get('epoch');
    if (typeof data.epoch === 'string') return data.epoch;
    const epoch = crypto.randomUUID();
    await chrome.storage.session.set({ epoch });
    return epoch;
  }
  async groups(): Promise<LiveGroup[]> {
    const [groups, tabs, windows] = await Promise.all([
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
      chrome.windows.getAll({ windowTypes: ['normal'] }),
    ]);
    const normal = new Set(windows.filter((w) => !w.incognito).map((w) => w.id));
    return groups
      .filter((g) => normal.has(g.windowId))
      .map((g) => ({
        id: g.id,
        windowId: g.windowId,
        title: g.title || '',
        color: g.color,
        collapsed: g.collapsed,
        tabIds: tabs
          .filter((t) => t.groupId === g.id && t.id !== undefined)
          .map((t) => t.id as number)
          .sort((a, b) => a - b),
      }));
  }
  async activeTab(): Promise<BrowserTab | null> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ? mapTab(tab) : null;
  }
  async tab(id: number): Promise<BrowserTab> {
    return mapTab(await chrome.tabs.get(id));
  }
  async normalWindow(id: number): Promise<boolean> {
    const w = await chrome.windows.get(id);
    return w.type === 'normal' && !w.incognito;
  }
  async move(id: number, windowId: number): Promise<void> {
    await chrome.tabs.move(id, { windowId, index: -1 });
  }
  async group(tabIds: number[], groupId?: number): Promise<number> {
    const [first, ...rest] = tabIds;
    if (first === undefined)
      throw new AppError('EMPTY_GROUP', 'A group must contain at least one tab.');
    const ids: [number, ...number[]] = [first, ...rest];
    return chrome.tabs.group(groupId === undefined ? { tabIds: ids } : { tabIds: ids, groupId });
  }
  async updateGroup(
    id: number,
    properties: { title?: string; color?: Color; collapsed?: boolean },
  ): Promise<void> {
    await chrome.tabGroups.update(id, properties);
  }
  async activate(id: number, windowId: number): Promise<void> {
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  }
  async createTab(): Promise<BrowserTab> {
    return mapTab(await chrome.tabs.create({ url: 'about:blank', active: false }));
  }
  async sessions(): Promise<ClosedTab[]> {
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
    // Never expose window sessions as recovery targets. Do not persist titles or URLs.
    return sessions.flatMap((s) =>
      s.tab?.sessionId && !s.tab.incognito && !s.tab.pinned
        ? [
            {
              sessionId: s.tab.sessionId,
              title: s.tab.title || 'Recently closed tab',
              lastModified: s.lastModified,
            },
          ]
        : [],
    );
  }
  async restoreTab(sessionId: string): Promise<BrowserTab> {
    if (!(await this.sessions()).some((s) => s.sessionId === sessionId))
      throw new AppError(
        'SESSION_MISSING',
        'That closed tab is no longer available. Choose another tab or recreate the group.',
      );
    const session = await chrome.sessions.restore(sessionId);
    if (!session.tab || session.window)
      throw new AppError(
        'SESSION_SCOPE',
        'The browser did not return a single tab. Inspect the browser before retrying.',
      );
    return mapTab(session.tab);
  }
  async shortcut(): Promise<string> {
    const commands = await chrome.commands.getAll();
    return commands.find((c) => c.name === '_execute_action')?.shortcut || '';
  }
}
