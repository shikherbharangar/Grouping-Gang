import type { CapturedSource } from '../shared/types';
import { object, integer } from '../storage/schema';
import { AppError } from '../domain/errors';
export interface LauncherHost {
  capture(): Promise<CapturedSource | null>;
  put(source: CapturedSource | null): Promise<void>;
  take(): Promise<CapturedSource | null>;
  open(): Promise<void>;
}
/** The action surface itself is single-instance. The lock also coalesces shortcut repeats. */
export class Launcher {
  private opening: Promise<void> | null = null;
  constructor(private readonly host: LauncherHost) {}
  open(): Promise<void> {
    if (this.opening) return this.opening;
    const work = (async () => {
      const source = await this.host.capture();
      if (!source)
        throw new AppError('SOURCE', 'Choose a webpage in a regular browser window first.');
      await this.host.put(source);
      try {
        await this.host.open();
      } catch (error) {
        await this.host.put(null);
        throw error;
      }
    })();
    this.opening = work.finally(() => {
      this.opening = null;
    });
    return this.opening;
  }
  async takeSource(): Promise<CapturedSource | undefined> {
    // Toolbar / legacy _execute_action access has no pre-open handoff. The native
    // action popup leaves the webpage's active-tab context intact, unlike a window.
    return (await this.host.take()) ?? (await this.host.capture()) ?? undefined;
  }
}
export function chromeLauncherHost(): LauncherHost {
  return {
    async capture() {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id === undefined
        ? null
        : { tabId: tab.id, windowId: tab.windowId, title: tab.title || 'Current tab' };
    },
    async put(source) {
      if (!source) {
        await chrome.storage.session.remove('launcherSource');
        return;
      }
      await chrome.storage.session.set({
        launcherSource: { ...source, expiresAt: Date.now() + 2000 },
      });
    },
    async take() {
      const data = await chrome.storage.session.get('launcherSource');
      await chrome.storage.session.remove('launcherSource');
      const value: unknown = data.launcherSource;
      return object(value) &&
        integer(value.tabId) &&
        integer(value.windowId) &&
        typeof value.title === 'string' &&
        integer(value.expiresAt) &&
        value.expiresAt > Date.now()
        ? { tabId: value.tabId, windowId: value.windowId, title: value.title }
        : null;
    },
    async open() {
      await chrome.action.openPopup();
    },
  };
}
