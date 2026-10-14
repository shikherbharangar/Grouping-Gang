import type { Registry, SessionState } from '../shared/types';
import { parseSession } from './session';
import { parseRegistry } from './schema';
export interface Repository {
  load(): Promise<Registry>;
  save(registry: Registry): Promise<void>;
  reset(): Promise<void>;
  loadSession(epoch: string, now: number): Promise<SessionState>;
  saveSession(session: SessionState): Promise<void>;
}
export const STORAGE_KEY = 'registry';
export class ChromeRepository implements Repository {
  async load(): Promise<Registry> {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return parseRegistry(data[STORAGE_KEY]);
  }
  async save(registry: Registry): Promise<void> {
    parseRegistry(registry);
    await chrome.storage.local.set({ [STORAGE_KEY]: registry });
  }
  async loadSession(epoch: string, now: number): Promise<SessionState> {
    const data = await chrome.storage.session.get('operations');
    return parseSession(data.operations, epoch, now);
  }
  async saveSession(session: SessionState): Promise<void> {
    await chrome.storage.session.set({ operations: session });
  }
  async reset(): Promise<void> {
    await chrome.storage.session.remove('operations');
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (data[STORAGE_KEY] !== undefined)
      await chrome.storage.local.set({ registryBackup: data[STORAGE_KEY] });
    await chrome.storage.local.remove(STORAGE_KEY);
  }
}
