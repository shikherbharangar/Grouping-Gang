import { Launcher, chromeLauncherHost } from '../application/launcher';
import { publishNotice, notificationAction, clearOldNotifications } from './notifications';
import { ChromeBrowser } from '../browser/gateway';
import { ChromeRepository } from '../storage/repository';
import { Engine } from '../application/engine';
import { isCommand } from '../application/commands';
import { errorMessage } from '../domain/errors';
const launcher = new Launcher(chromeLauncherHost());
const engine = new Engine(new ChromeRepository(), new ChromeBrowser());
const noticeReady = clearOldNotifications().catch(report);
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
    void (async () => {
      const source =
        message.type === 'state' && message.capture ? await launcher.takeSource() : undefined;
      const result = await engine.dispatch(message, source);
      respond(result);
      await noticeReady;
      if (result.ok && result.notice) await publishNotice(result.notice);
    })().catch((error) => {
      respond({
        ok: false,
        code: 'SOURCE',
        message: 'Could not capture the source tab. Reopen the launcher from a webpage.',
      });
      report(error);
    });
    return true;
  },
);
function report(error: unknown): void {
  console.error('Grouping Gang:', errorMessage(error));
}
async function notifyViews(): Promise<void> {
  await noticeReady;
  await publishNotice(await engine.latestNotice());
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

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-launcher') void launcher.open().catch(report);
});
const undoing = new Set<string>();
function handleUndo(id: string): void {
  if (undoing.has(id)) return;
  const command = notificationAction(id);
  if (!command) return;
  undoing.add(id);
  void chrome.notifications.clear(id).catch(report);
  void engine
    .dispatch(command)
    .then(async (result) => {
      if (!result.ok) {
        console.warn('Grouping Gang undo:', result.message);
        await chrome.notifications.create('grouping-gang:undo-error', {
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Undo unavailable',
          message: result.message,
        });
        setTimeout(() => {
          void chrome.notifications.clear('grouping-gang:undo-error').catch(report);
        }, 5000);
      }
      await notifyViews();
    })
    .catch(report)
    .finally(() => undoing.delete(id));
}
chrome.notifications.onClicked.addListener(handleUndo);
chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (index === 0) handleUndo(id);
});
