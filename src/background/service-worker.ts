import { ChromeBrowser } from '../browser/gateway';
import { ChromeRepository } from '../storage/repository';
import { Engine } from '../application/engine';
import { isCommand } from '../application/commands';
import { errorMessage } from '../domain/errors';
const engine = new Engine(new ChromeRepository(), new ChromeBrowser());
chrome.runtime.onMessage.addListener(
  (message: unknown, sender, respond: (value: unknown) => void) => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL('src/')) ||
      !isCommand(message)
    ) {
      respond({ ok: false, code: 'MESSAGE', message: 'Invalid extension request.' });
      return false;
    }
    void engine.dispatch(message).then(respond);
    return true;
  },
);
function report(error: unknown): void {
  console.error('Grouping Gang:', errorMessage(error));
}
async function notifyViews(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'invalidated' });
  } catch (error) {
    // No UI is normally open. This is an expected absence, not an operation failure.
    if (
      !errorMessage(error).includes('Receiving end does not exist') &&
      !errorMessage(error).includes('message port closed')
    )
      report(error);
  }
}
let queued = false;
function schedule(): void {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    void engine.reconcileEvent().then(notifyViews).catch(report);
  }, 60);
}
chrome.tabGroups.onCreated.addListener(schedule);
chrome.tabGroups.onUpdated.addListener(schedule);
chrome.tabGroups.onMoved.addListener(schedule);
chrome.tabGroups.onRemoved.addListener((group) => {
  void engine.reconcileEvent(group.id).then(notifyViews).catch(report);
});
chrome.tabs.onCreated.addListener(schedule);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if ('groupId' in change || 'pinned' in change) schedule();
});
chrome.tabs.onMoved.addListener(schedule);
chrome.tabs.onRemoved.addListener(schedule);
chrome.tabs.onAttached.addListener(schedule);
chrome.tabs.onDetached.addListener(schedule);
chrome.tabs.onReplaced.addListener(schedule);
chrome.windows.onCreated.addListener(schedule);
chrome.windows.onRemoved.addListener(schedule);
chrome.sessions.onChanged.addListener(schedule);
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(report);
